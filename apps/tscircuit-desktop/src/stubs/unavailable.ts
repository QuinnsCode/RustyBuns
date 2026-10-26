// Stand-in for optional tscircuit exporters whose packages don't build
// outside their monorepo (circuit-json-to-altium). They are only ever
// lazy-imported from the export menu, so failing at call time is enough.
const fail = () => Promise.reject(new Error("This export isn't available in the desktop app."));
export default new Proxy({}, { get: () => fail });
export const convertCircuitJsonToAltium = fail;
