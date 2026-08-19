"use strict";

// Replaces the abandoned `repository-dynamodb` package, which reached the AWS SDK v2 and
// `dynamodb-doc` - both end-of-support - through its own dependencies rather than ours.
//
// findBy, addOrReplace and removeBy keep that package's callback signatures, INCLUDING the arity a
// delete calls back with, which async.waterfall depends on. What it also exposed and this does not
// is `docClient`: the two custom finders reached through it to build pre-2014 KeyConditions
// queries, and both were rewritten here onto queryByEquality.
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
// Keyed by endpoint as well as region. The SDK resolves AWS_ENDPOINT_URL_DYNAMODB once, on a
// client's FIRST send, and memoises it for that client's lifetime - so a client cached across a
// change of that variable keeps addressing the old endpoint. In a test run that means a suite
// silently talking to real AWS instead of the local container, which passes locally and does
// damage in CI, where credentials exist.
const clients = new Map();

function documentClient(awsRegion) {
  const key = awsRegion + "|" + (process.env.AWS_ENDPOINT_URL_DYNAMODB || "");
  if (!clients.has(key)) {
    clients.set(key, DynamoDBDocumentClient.from(new DynamoDBClient({ region: awsRegion })));
  }
  return clients.get(key);
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

// Deletes call back with NO value, matching the package this replaced. That is not cosmetic:
// async.waterfall forwards every argument after `err` to the next task, so a value here shifts that
// task's arguments and binds its continuation to undefined. The symptom is an uncaught
// "callback is not a function" thrown from a later callback - the request never answers and the
// process dies - and it only appears on the SECOND write of a given device, because the first takes
// the not-found branch. No test sees it if the stubs encode the old arity.
function adaptVoid(promise, callback) {
  promise.then(
    () => process.nextTick(() => callback(null)),
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

    adaptVoid(client.send(new DeleteCommand({ TableName: tableName, Key: key })), callback);
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
    // matches. That is not hypothetical here: of 40 descriptor groups, 5 exceed the page and the
    // largest holds 1,571 devices at roughly 2.1MB, so a single request returns about half of them
    // (full production scan of linn.cloud.devices, 11,721 items, 2026-08-18). The populator's
    // unpublish then deletes the devices it was handed and removes the parent, stranding the rest
    // with nothing left to enumerate them.
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
