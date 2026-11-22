import { launch_service_fixture } from "./ServiceFixture.js";

export async function launch_instrument_fixture(entry, options, test) {
  const remote = await launch_service_fixture(entry, options, test);
  const store = {
    get sessions() {
      return new Map(
        remote.sync("state").sessions.map((item) => [item.id, item]),
      );
    },
    get exports() {
      return new Map(
        remote.sync("state").exports.map((item) => [item.id, item]),
      );
    },
    get reservation() {
      return remote.sync("state").reservation;
    },
    get(_collection, id, owner) {
      return remote.sync("get", { id, owner });
    },
    lookup(_collection, id, owner) {
      return remote.request("lookup", { id, owner });
    },
    status(value) {
      return value;
    },
    initialize() {
      return remote.request("restart");
    },
  };
  return { ...remote, store, restart: () => remote.request("restart") };
}
