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

// Keyed by region rather than a single shared client: a lone client would silently serve a
// repository constructed for a different region than the one it asked for.
const clientsByRegion = new Map();

function documentClient(awsRegion) {
  if (!clientsByRegion.has(awsRegion)) {
    clientsByRegion.set(awsRegion, DynamoDBDocumentClient.from(new DynamoDBClient({ region: awsRegion })));
  }
  return clientsByRegion.get(awsRegion);
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
      // Without this the key becomes a literal { undefined: <value> } and DynamoDB reports a
      // validation error about the schema rather than about the caller, which is where the bug is.
      if (!rangeKey) {
        throw new Error("a range key was supplied for " + tableName + ", which has no range key");
      }
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
    // Validated before the map: Object.keys(undefined) throws SYNCHRONOUSLY, which escapes the
    // callback contract entirely - the caller's callback never fires and a waterfall simply stops.
    const equals = (params && params.equals) || {};
    if (Object.keys(equals).length === 0) {
      return process.nextTick(function () {
        callback(new Error("queryByEquality on " + tableName + " needs at least one attribute to match"));
      });
    }

    const names = {};
    const values = {};
    const conditions = Object.keys(equals).map((attribute, index) => {
      names["#a" + index] = attribute;
      values[":v" + index] = equals[attribute];
      return "#a" + index + " = :v" + index;
    });

    // Paged to exhaustion, not a single request. DynamoDB caps a Query response at 1MB and reports
    // the cut with LastEvaluatedKey; a caller that ignores it silently receives a PREFIX of the
    // matches. That is not hypothetical here - one descriptor group holds 1,571 devices at roughly
    // 2.1MB, so a single request returns about half of them, and unpublish deletes the devices it
    // was handed and then removes the parent, stranding the rest with nothing left to enumerate them.
    const collect = async () => {
      const items = [];
      let startKey;
      do {
        const page = await client.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: params.indexName,
            KeyConditionExpression: conditions.join(" and "),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ExclusiveStartKey: startKey,
          })
        );
        if (page.Items) {
          items.push(...page.Items);
        }
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      return items;
    };

    adapt(collect(), (items) => items, callback);
  }

  return {
    findBy: findBy,
    addOrReplace: addOrReplace,
    removeBy: removeBy,
    queryByEquality: queryByEquality,
  };
};
