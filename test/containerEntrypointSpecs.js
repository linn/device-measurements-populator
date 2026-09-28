'use strict';

// A structural proxy, deliberately. A SIGTERM reaching node as PID 1 is only observable inside a
// container, so nothing in this suite can assert it directly - integration/shutdownSignalSpecs drives
// bin/www itself but on the host. What this CAN do is refuse the edits that silently stop the signal
// arriving: npm back in front of node, which makes node a grandchild of PID 1 and leaves the forwarded
// signal at the intervening shell, or a different stop signal.

const chai = require('chai');
const expect = chai.expect;
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

// Dockerfile instructions are case-insensitive, so a lower-case one must not slip past.
function instructions(keyword) {
    return dockerfile.split('\n').filter((line) => new RegExp(`^\\s*${keyword}\\b`, 'i').test(line));
}

const entrypointLines = instructions('ENTRYPOINT');

describe('the container entrypoint', () => {
    it('is declared exactly once', () => {
        expect(entrypointLines).to.have.lengthOf(1);
    });

    it('uses the exec form, not the shell form', () => {
        // Checked before parsing, and as its own assertion: a string ENTRYPOINT is run via /bin/sh -c,
        // which reintroduces the very indirection the array form exists to remove - and it would
        // otherwise surface as an opaque JSON.parse error rather than as this.
        expect(entrypointLines[0]).to.contain('[');
    });

    it('executes node directly rather than through npm', () => {
        const argv = JSON.parse(entrypointLines[0].slice(entrypointLines[0].indexOf('[')));
        expect(argv[0]).to.equal('node');
    });

    it('runs exactly what `npm start` would have run', () => {
        // If the start script ever grows a flag, production would silently stop getting it.
        const argv = JSON.parse(entrypointLines[0].slice(entrypointLines[0].indexOf('[')));
        expect(argv.join(' ')).to.equal(packageJson.scripts.start);
    });

    it('leaves no npm lifecycle hook that bypassing npm would silently skip', () => {
        // `npm start` also ran prestart and poststart. The entrypoint no longer goes through npm, so a
        // hook added later would stop running in production with nothing to say so.
        expect(packageJson.scripts).to.not.have.any.keys('prestart', 'poststart');
    });

    it('declares no CMD, which would only be arguments to node', () => {
        expect(instructions('CMD')).to.deep.equal([]);
    });

    it('declares no STOPSIGNAL, so ECS stops the container with the SIGTERM the drain listens for', () => {
        expect(instructions('STOPSIGNAL')).to.deep.equal([]);
    });
});

describe('the shutdown budget against the ECS stop timeout', () => {
    const template = fs.readFileSync(
        path.join(REPO_ROOT, 'aws', 'deviceMeasurementsPopulatorCloudFormation.yaml'),
        'utf8'
    );
    const config = require('../shutdownConfig');

    it('declares exactly one StopTimeout', () => {
        // Parser-free on purpose. Attributing a value to a container means working out where its block
        // begins and ends, and that logic is easy to get subtly wrong in a way that silently reads a
        // neighbour's number. Counting cannot be wrong that way: the moment a second container exists
        // to be confused with ours, this fails and a human decides.
        const declared = template.split('\n').filter((l) => /^\s*StopTimeout:/.test(l));
        expect(declared).to.have.lengthOf(1);
    });

    it('finishes draining AND flushing before ECS would kill the container', () => {
        const match = template.match(/^\s*StopTimeout:\s*(\d+)\s*$/m);
        expect(match, 'no StopTimeout in the template').to.not.equal(null);
        const budget = config.DRAIN_TIMEOUT_MS + config.EXIT_FLUSH_TIMEOUT_MS;
        expect(budget).to.be.below(Number(match[1]) * 1000);
    });

    it('holds a connection open for longer than the ALB will', () => {
        // The direction is the point: node closing first is what lets the ALB dispatch onto a socket
        // it thinks is reusable and report the reset as a 502.
        expect(config.KEEP_ALIVE_TIMEOUT_MS).to.be.above(60000);
    });
});

describe('the entry point', () => {
    it('holds signals before it loads anything else', () => {
        // Node as PID 1 discards SIGTERM while nothing listens for it, so the hold has to be registered
        // before the rest of the dependency graph loads - and only the order of statements decides that.
        const www = fs.readFileSync(path.join(REPO_ROOT, 'bin', 'www'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const statements = www
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => !line.startsWith('//'))
            .filter((line) => line.includes('require(') || line.includes('holdSignalsUntilInstalled('));
        expect(statements.slice(0, 2)).to.deep.equal([
            "var gracefulShutdown = require('@linn-cloud/graceful-shutdown');",
            'gracefulShutdown.holdSignalsUntilInstalled();',
        ]);
    });
});
