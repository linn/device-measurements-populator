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
// Keyed by endpoint as well as region, so a client built before AWS_ENDPOINT_URL_DYNAMODB changed
// is not handed to a caller that expects the new one.
//
// Stated precisely, because the guarantee is narrower than it looks: the key is read at CONSTRUCTION
// while the SDK binds the endpoint at a client's FIRST SEND and memoises it thereafter. So this
// separates clients constructed either side of a change; it cannot help a client constructed before
// a change whose first send happens after one. That residual is not reachable today - every client
// built before the test harness starts is either unused or first sent while the harness is up - but
// the key is not a faithful record of where a client is bound, and should not be read as one.
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
// task's arguments and binds its continuation to undefined, and the symptom is an uncaught
// "callback is not a function" - the request never answers and the process dies.
//
// It was device-measurements-populator that this crashed, on the second write of any device, since
// only that service deletes inside a waterfall. This copy has no caller of removeBy at all; the
// arity is kept identical because the two copies of this module are held byte-identical on purpose,
// and a divergence introduced "because nothing here calls it" is how the next caller inherits the
// bug.
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
