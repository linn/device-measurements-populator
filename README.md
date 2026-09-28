[![](https://images.microbadger.com/badges/image/linn/device-measurements-populator.svg)](https://microbadger.com/images/linn/device-measurements-populator "Get your own image badge on microbadger.com") [![](https://images.microbadger.com/badges/version/linn/device-measurements-populator.svg)](https://microbadger.com/images/linn/device-measurements-populator "Get your own version badge on microbadger.com")
[![codecov](https://codecov.io/gh/linn/device-measurements-populator/branch/master/graph/badge.svg?token=zlSxkTS169)](https://codecov.io/gh/linn/device-measurements-populator)
[![Build Status](https://travis-ci.com/linn/device-measurements-populator.svg?token=tCfyrpfmKKcSxC72Y7mq&branch=master)](https://travis-ci.com/linn/device-measurements-populator)

# device-measurements-populator

Writes Exakt product descriptors and per-device measurements to DynamoDB, and the measurement files
that go with them to S3. `device-measurements-api` reads back what this service publishes.

## Checking a deployed environment

`scripts/smoke-test.sh` publishes a throwaway product descriptor and one device through this service,
reads the measurements back through `device-measurements-api`, then removes both and proves they are
gone. It writes nothing that outlives the run, and removes what it wrote even when a step fails. The
populator sits behind internal load balancers, so run it from inside the network (the VPN).

```
bash scripts/smoke-test.sh --target sys
```

`--target` names a known deployment: `sys`, `prod-new` (the app load balancer), `prod-old` (the
`ecs-internal` load balancer) or `prod-dual` (both prod addresses, the check on a dual-homed deploy).
Any prod target also requires `--yes-write-to-prod`. `--populator` and `--measurements` can be given
instead, each repeatably, to point it somewhere else. `bash scripts/smoke-test.sh --help` prints the full
contract.

## Deploying

CI deploys every environment; nothing is deployed by hand.

- A pull request that targets `master` deploys **sys**.
- A `master` build (a merge) deploys **prod**.
- A build of any other branch deploys nothing.

Each deploying build then files a CycloneDX SBOM for the image it shipped in that environment's store
(`linn-api-infrastructure-{sys,prod}-sbom-store`), through `scripts/emit-service-sbom.sh`, the same
emitter as the rest of the estate. The populator is in CRA scope because it runs on the apps cluster.

`deploy.sh` refuses to create a prod stack: prod always updates the existing one,
`deviceMeasurementPopulator`, so a deploy can never leave a second prod service beside it.

### The first prod deploy moves the service onto the apps cluster

The prod service created in 2016 runs on IT's `production-cluster-v2` and is registered with a
hand-built target group, `populator-temp`, on the unmanaged `ecs-internal` load balancer, which its
current callers reach. The first `master` build of this template moves it:

- It updates the **same** stack. The ECS service is **replaced**, not duplicated: the template drops
  the custom service `Role` (a service with two target groups must use the service-linked role) and
  changes its cluster, and neither can change in place. CloudFormation creates the new service on the
  apps cluster (`LinnApiClusterName-prod`, the SSM parameter linn-api-infrastructure publishes), waits
  for it to be stable, and deletes the 2016 service in the stack's cleanup phase, after the whole update
  has succeeded. Its generated name differs from the old one's.
- The new service is **dual-homed**: registered with `measurements-populator` on the app load balancer
  *and* with `populator-temp`, so requests through `ecs-internal` keep being served, during the move and
  after it. For the few minutes both services run, `populator-temp` routes to either; they share the same
  tables and bucket.
- If the new service never stabilises, the stack rolls back and the 2016 service is untouched. The
  template has no deployment circuit breaker, so that wait can run for hours.

Before merging the pull request that makes this first prod deploy, check, since a failure here only
shows up at deploy time:

- `LinnApiClusterName-prod` resolves to the apps cluster.
- `populator-temp` is in the same VPC as that cluster, and its health check passes against the new
  image.
- The log group `/ecs/deviceMeasurementPopulator` does not exist yet (the template creates it, and a
  deploy fails if the name is taken). This must print nothing:
  `aws logs describe-log-groups --log-group-name-prefix /ecs/deviceMeasurementPopulator --query "logGroups[?logGroupName=='/ecs/deviceMeasurementPopulator'].logGroupName" --output text`
- The CI user can deploy prod: CloudFormation on the 2016 stack, IAM for the task role, ECS on both
  clusters, logs, and registering with `populator-temp`. Only the first `master` build proves it.

### Dropping `populator-temp`

Once no caller uses the `ecs-internal` address, a pull request sets `LEGACY_TARGET_GROUP_ARN=none` in
`deploy.sh`'s prod arm (and the matching assertion in `test/scripts/deployArmSpecs.js`). Its merge
redeploys prod registered with `measurements-populator` alone. Check afterwards with
`bash scripts/smoke-test.sh --target prod-new --yes-write-to-prod`; before then, `--target prod-dual`
checks both addresses.
