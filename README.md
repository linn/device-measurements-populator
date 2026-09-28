[![](https://images.microbadger.com/badges/image/linn/device-measurements-populator.svg)](https://microbadger.com/images/linn/device-measurements-populator "Get your own image badge on microbadger.com") [![](https://images.microbadger.com/badges/version/linn/device-measurements-populator.svg)](https://microbadger.com/images/linn/device-measurements-populator "Get your own version badge on microbadger.com")
[![codecov](https://codecov.io/gh/linn/device-measurements-populator/branch/master/graph/badge.svg?token=zlSxkTS169)](https://codecov.io/gh/linn/device-measurements-populator)
[![Build Status](https://travis-ci.com/linn/device-measurements-populator.svg?token=tCfyrpfmKKcSxC72Y7mq&branch=master)](https://travis-ci.com/linn/device-measurements-populator)

# device-measurements-populator

Writes Exakt product descriptors and per-device measurements to DynamoDB, and the measurement files
that go with them to S3. `device-measurements-api` reads back what this service publishes.

## Checking a deployed environment

`scripts/smoke-test.sh` publishes a throwaway product descriptor and one device through this service,
reads the measurements back through `device-measurements-api`, then removes both and proves they are
gone. It writes nothing that outlives the run, and removes what it wrote even when a step fails.

```
bash scripts/smoke-test.sh --env sys \
    --populator http://<this-service> --measurements http://<measurements-api>
```

Both options are repeatable, which is how to check a service registered with more than one load
balancer: pass every address and it reports the build each one is serving, runs a publish/read/remove
cycle through each populator, and reads every cycle back through each measurements endpoint.

`--env prod` additionally requires `--yes-write-to-prod`, because the script cannot tell from a URL
where it is pointed. `bash scripts/smoke-test.sh --help` prints the full contract.
