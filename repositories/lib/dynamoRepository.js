"use strict";

// Replaces the abandoned `repository-dynamodb` package, which reached the AWS SDK v2 and
// `dynamodb-doc` - both end-of-support - through its own dependencies rather than ours. The
// callback signatures below are deliberately identical to the ones it exposed, so no caller had
// to change when it was dropped.
//
// The client honours AWS_ENDPOINT_URL_DYNAMODB, which the SDK reads on its own. That is what lets
// the round-trip tests point at DynamoDB Local without production code carrying a test seam.

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

let sharedClient;

function documentClient(awsRegion) {
  if (!sharedClient) {
    sharedClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: awsRegion }));
  }
  return sharedClient;
}

// The callers are callback-style throughout. Rather than convert them, each command is adapted
// here - and `callback` is invoked outside the promise chain, so a throw inside a caller's
// callback surfaces as an unhandled error rather than being swallowed as a rejection and retried.
function adapt(promise, onResolved, callback) {
  promise.then(
    (result) => {
      let value;
      try {
        value = onResolved(result);
      } catch (err) {
        return process.nextTick(() => callback(err));
      }
      process.nextTick(() => callback(null, value));
    },
    (err) => process.nextTick(() => callback(err))
  );
}

module.exports = function DynamoDbRepository(awsRegion, tableName, hashKey, rangeKey) {
  const client = documentClient(awsRegion);

  function keyFor(id, range) {
    const key = { [hashKey]: id };
    if (range !== undefined) {
      key[rangeKey] = range;
    }
    return key;
  }

  function findBy(id, rangeOrCallback, maybeCallback) {
    const hasRange = typeof rangeOrCallback !== "function";
    const callback = hasRange ? maybeCallback : rangeOrCallback;
    const key = keyFor(id, hasRange ? rangeOrCallback : undefined);

    adapt(
      client.send(new GetCommand({ TableName: tableName, Key: key })),
      (result) => result.Item,
      callback
    );
  }

  function addOrReplace(item, callback) {
    adapt(
      client.send(new PutCommand({ TableName: tableName, Item: item })),
      () => undefined,
      callback
    );
  }

  function removeBy(id, rangeOrCallback, maybeCallback) {
    const hasRange = typeof rangeOrCallback !== "function";
    const callback = hasRange ? maybeCallback : rangeOrCallback;
    const key = keyFor(id, hasRange ? rangeOrCallback : undefined);

    adapt(
      client.send(new DeleteCommand({ TableName: tableName, Key: key })),
      () => undefined,
      callback
    );
  }

  // The equality-only query the two custom finders need. Attribute names are always aliased,
  // because DynamoDB reserves several hundred words and a collision fails only at runtime, on the
  // one attribute nobody thought to check.
  function queryByEquality(params, callback) {
    const names = {};
    const values = {};
    const conditions = Object.keys(params.equals).map((attribute, index) => {
      names["#a" + index] = attribute;
      values[":v" + index] = params.equals[attribute];
      return "#a" + index + " = :v" + index;
    });

    adapt(
      client.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: params.indexName,
          KeyConditionExpression: conditions.join(" and "),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        })
      ),
      (result) => result.Items,
      callback
    );
  }

  return {
    findBy: findBy,
    addOrReplace: addOrReplace,
    removeBy: removeBy,
    queryByEquality: queryByEquality,
  };
};
