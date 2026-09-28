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
bash scripts/deploy.sh prod <build-number>
```

### The first prod deploy is a cutover

Prod's 2016 service is registered with a hand-built target group, `populator-temp`, on the unmanaged
`ecs-internal` load balancer, which its current callers reach. This template registers the service with
`measurements-populator` on the app load balancer instead, and while `deploy.sh`'s prod arm names
`populator-temp` as the legacy target group, with that one as well. So the order is:

1. **Check the log group does not already exist.** The template creates `/ecs/deviceMeasurementPopulator`
   and a deploy fails (and rolls back) if the name is taken:
   `aws logs describe-log-groups --log-group-name-prefix /ecs/deviceMeasurementPopulator`
2. **Deploy dual-homed:** `bash scripts/deploy.sh prod <build-number>`. This *replaces* the ECS service
   rather than updating it, because the template drops the custom service `Role` (a service with two
   target groups must use the service-linked role). CloudFormation creates the new service, waits for it
   to be stable, and only then deletes the 2016 one; if the new service never stabilises the stack rolls
   back and the old one is untouched. The new service's name is generated, so anything that looks the
   service up by name must be updated.
3. **Prove both addresses:** `bash scripts/smoke-test.sh --target prod-dual --yes-write-to-prod`.
4. **Move every caller** off the `ecs-internal` address onto the app load balancer.
5. **Drop the legacy target group:** set `LEGACY_TARGET_GROUP_ARN=none` in `deploy.sh`'s prod arm, merge,
   redeploy, and check with `bash scripts/smoke-test.sh --target prod-new --yes-write-to-prod`.
