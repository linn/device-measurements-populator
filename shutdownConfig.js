"use strict";

// The timings the shared drain needs. They live here rather than in @linn-cloud/graceful-shutdown
// because they are properties of THIS deployment: the drain has to finish inside the stop timeout
// this task definition declares, and the keep-alive has to outlast the load balancer in front of
// this service.

// ECS escalates SIGTERM to SIGKILL when the task's StopTimeout expires, and a SIGKILL severs exactly
// the requests the drain exists to protect. This plus EXIT_FLUSH_TIMEOUT_MS must stay under the
// StopTimeout declared in ContinuousIntegration/CloudFormation.
var DRAIN_TIMEOUT_MS = 20000;

// How long to wait for the log streams before leaving anyway. process.exit() discards queued stdout,
// and under docker stdout is a pipe.
var EXIT_FLUSH_TIMEOUT_MS = 2000;

// The ALB reuses idle keep-alive connections. If node retires one first, the ALB can still dispatch a
// request onto it and reports the reset to the caller as a 502 - so node must hold a connection open
// for longer than the ALB will. 65s clears the AWS default idle timeout of 60s.
var KEEP_ALIVE_TIMEOUT_MS = 65000;

module.exports = {
  DRAIN_TIMEOUT_MS: DRAIN_TIMEOUT_MS,
  EXIT_FLUSH_TIMEOUT_MS: EXIT_FLUSH_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS: KEEP_ALIVE_TIMEOUT_MS,
};
