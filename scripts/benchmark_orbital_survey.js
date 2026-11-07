import { performance } from "node:perf_hooks";
import { OrbitalDataStore } from "../servers/fracto-data-server/handlers/orbital_data_store.js";
import { calculate_seed_survey } from "../servers/fracto-data-server/handlers/handle_orbital.js";
import { scan_orbitals } from "../servers/fracto-ui/src/pages/assets/surveys/SeedSurveyScan.js";
import { canonical_orbital } from "../sdk/orbitals/FractoOrbitalIdentity.js";
import { calculate_orbital_landing_ratios } from "../sdk/orbitals/FractoOrbitalDiscovery.js";
import { discovery_request } from "../servers/fracto-data-server/handlers/orbital_data_contract.js";

const store = new OrbitalDataStore();
try {
  const source = await store.source(String(process.argv[2] || "65"));
  const size = Number(process.argv[3] || 31);
  const parameter = {
    x: Number(source.parameter.x),
    y: Number(source.parameter.y),
  };
  let last = 0;
  const start = performance.now();
  const survey = calculate_seed_survey(
    parameter,
    undefined,
    (progress) => {
      if (performance.now() - last > 5000) {
        console.log(
          JSON.stringify({
            phase: "survey",
            completed: progress.total_samples,
          }),
        );
        last = performance.now();
      }
    },
    {
      grid_size: size,
      canvas_size: size,
      half_span: 1.5,
      iteration_limit: 100000,
      sampling: "bounds",
      encoding: "rows",
    },
  );
  console.log(
    JSON.stringify({
      phase: "scan",
      survey_seconds: (performance.now() - start) / 1000,
    }),
  );
  const found = await scan_orbitals(
    {
      ...survey,
      focal_point: parameter,
      half_span: 1.5,
      iteration_limit: 100000,
      sampling: "bounds",
    },
    {
      pause: async () => {},
      on_progress: (progress) => {
        if (performance.now() - last > 5000) {
          console.log(JSON.stringify({ phase: "scan", ...progress }));
          last = performance.now();
        }
      },
    },
  );
  console.log(
    JSON.stringify(
      {
        source: source.id,
        pattern: source.pattern,
        size,
        seconds: (performance.now() - start) / 1000,
        orbitals: found.map((o) => ({
          period: o.points.length,
          confidence: o.confidence,
          discoveries: o.discovery_count,
          seed: o.seed,
          strict_storage_accepted: Boolean(
            canonical_orbital(source.parameter, o.precise_points),
          ),
          closure_error: o.closure_error,
        })),
      },
      null,
      2,
    ),
  );
  if (process.argv[4] !== undefined) {
    const chosen = found[Number(process.argv[4])];
    const ray_start = performance.now();
    const result = await calculate_orbital_landing_ratios(
      {
        parameter: source.parameter,
        orbital: {
          points: chosen.precise_points,
          period: chosen.points.length,
        },
        settings: discovery_request({ free_bailiwick_id: source.id }).settings,
      },
      (progress) => {
        if (performance.now() - last > 5000) {
          console.log(JSON.stringify(progress));
          last = performance.now();
        }
      },
    );
    console.log(
      JSON.stringify({
        phase: "rays_done",
        seconds: (performance.now() - ray_start) / 1000,
        status: result.status,
        ratios: result.ratios.length,
        metadata: result.metadata,
      }),
    );
  }
} finally {
  await store.close();
}
