class Telemetry {
    static initialize() {
        return new Telemetry();
    }

    trackEvent() {}

    trackError() {}

    async shutdown() {}
}

module.exports = { Telemetry };
