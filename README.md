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

sys is deployed by CI, from every pull request that targets `master`. Prod is deployed by hand, from the
image a `master` build pushed (its tag is that build's Travis build number):

```
bash scripts/deploy.sh prod <build-number>            # deploy
bash scripts/deploy.sh prod <build-number> --review   # create the change set only, for reading first
```

The prod arm refuses to run if the stack it names does not exist, so it can never create a second prod
service. Background: [issue #12](https://github.com/linn/device-measurements-populator/issues/12).

### The first prod deploy is a cutover

Prod's 2016 service runs on `production-cluster-v2` and is registered with a hand-built target group,
`populator-temp`, on the unmanaged `ecs-internal` load balancer, which its current callers reach. This
template runs the service on the estate cluster (`LinnApiClusterName-prod`, the SSM parameter
linn-api-infrastructure publishes) and registers it with `measurements-populator` on the app load
balancer - and, while `deploy.sh`'s prod arm names `populator-temp` as the legacy target group, with that
one as well. So the order is:

1. **Preconditions.**
   - The log group must not exist yet, because the template creates it (and a deploy fails and rolls
     back if the name is taken). This must print nothing:
     `aws logs describe-log-groups --log-group-name-prefix /ecs/deviceMeasurementPopulator --query "logGroups[?logGroupName=='/ecs/deviceMeasurementPopulator'].logGroupName" --output text`
     If it prints the name, stop: the group has to be imported into the stack or removed first.
   - `populator-temp` must be in the same VPC as the estate cluster, and its health check must pass
     against the new image, or the new service never becomes stable.
2. **Read the change set:** `bash scripts/deploy.sh prod <build-number> --review`, then check the change
   set in the console. The ECS service should show `Replacement: True`. It is replaced, not updated,
   because the template drops the custom service `Role` (a service with two target groups must use the
   service-linked role) and changes its cluster.
3. **Deploy dual-homed:** `bash scripts/deploy.sh prod <build-number>`. CloudFormation creates the new
   service and waits for it to be stable; the 2016 service keeps serving throughout and is deleted only in
   the stack's cleanup phase, after the whole update has succeeded. If the new service never stabilises
   the stack rolls back and the old one is untouched - but the template has no deployment circuit
   breaker, so that wait can run for hours; `aws cloudformation cancel-update-stack` ends it sooner. The
   new service's name is generated, so anything that looks the service up by name must be updated.
4. **Prove both addresses:** `bash scripts/smoke-test.sh --target prod-dual --yes-write-to-prod`.
5. **Move every caller** off the `ecs-internal` address onto the app load balancer, and confirm
   `populator-temp` has stopped receiving requests before the next step.
6. **Drop the legacy target group:** set `LEGACY_TARGET_GROUP_ARN=none` in `deploy.sh`'s prod arm (and the
   matching assertion in `test/scripts/deployArmSpecs.js`), merge, redeploy, and check with
   `bash scripts/smoke-test.sh --target prod-new --yes-write-to-prod`.

After step 3 there is no way back to the 2016 service - its cleanup deletes it - so a problem found in
steps 4 or 5 is fixed forward: redeploy an earlier `master` build number. The new service stays
registered with `populator-temp` until step 6, so callers on `ecs-internal` are unaffected either way.
