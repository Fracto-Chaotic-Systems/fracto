import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
export const MOUNT_CONTRACT = ".fracto-managed/required-config-mounts.json";

const normalized = (value) => value.replaceAll("\\", "/").replace(/\/$/, "");
const same_source = (a, b) => normalized(a) === normalized(b);
const paths_for = (root) => (/^[A-Za-z]:[\\/]/.test(root) ? path.win32 : path);

/** Resolve Windows bind paths through an existing, verified Docker Desktop mount. */
export function configuration_mounts(
  configuration,
  root,
  current,
  stat = fs.statSync,
) {
  const paths = paths_for(root);
  const binds = (configuration.services?.fracto?.volumes || []).filter(
    (item) => item.type === "bind" && item.read_only === true,
  );
  const engine_roots = new Set();
  for (const bind of binds) {
    const mounted = current?.Mounts?.find(
      (item) => item.Type === "bind" && item.Destination === bind.target,
    );
    if (!mounted) continue;
    const relative = normalized(paths.relative(root, bind.source));
    if (!relative || relative.startsWith("../") || paths.isAbsolute(relative))
      continue;
    const source = normalized(mounted.Source),
      suffix = "/" + relative;
    if (source.toLowerCase().endsWith(suffix.toLowerCase()))
      engine_roots.add(source.slice(0, -suffix.length));
  }
  return binds.map((bind) => {
    if (
      !paths.isAbsolute(bind.source) ||
      !bind.target?.startsWith("/") ||
      bind.target.split("/").includes("..")
    )
      throw Error("Invalid read-only deployment bind mount");
    let info;
    try {
      info = stat(bind.source);
    } catch {
      throw Error(
        `Required deployment mount source is missing or unreadable: ${bind.source}`,
      );
    }
    if (!info.isDirectory() && !info.isFile())
      throw Error("Unsupported deployment mount source");
    let source = bind.source;
    if (current && /^[A-Za-z]:[\\/]/.test(source)) {
      const mounted = current.Mounts?.find(
        (item) => item.Type === "bind" && item.Destination === bind.target,
      );
      const relative = normalized(paths.relative(root, source));
      if (
        !relative ||
        relative.startsWith("../") ||
        paths.isAbsolute(relative) ||
        engine_roots.size !== 1
      )
        throw Error(
          "Cannot verify the Docker Desktop path for a required configuration mount",
        );
      source = [...engine_roots][0] + "/" + relative;
      if (mounted && !same_source(mounted.Source, source))
        throw Error(
          "Existing configuration mount differs from the resolved Compose source",
        );
    }
    return {
      Type: "bind",
      Source: source,
      Target: bind.target,
      ReadOnly: true,
    };
  });
}

/** Add only declared configuration binds; keep data volumes and runtime limits intact. */
export function reconcile_managed_mounts(payload, required) {
  if (!payload?.HostConfig || !Array.isArray(required) || required.length > 128)
    throw Error(
      "Unsupported managed container payload or configuration mount contract",
    );
  const host = { ...payload.HostConfig },
    mounts = [...(host.Mounts || [])],
    binds = [...(host.Binds || [])];
  for (const item of required) {
    if (
      item.Type !== "bind" ||
      item.ReadOnly !== true ||
      typeof item.Source !== "string" ||
      !item.Source ||
      !item.Target?.startsWith("/") ||
      item.Target.split("/").includes("..")
    )
      throw Error("Invalid managed configuration mount contract");
    const matches = mounts.filter((entry) => entry.Target === item.Target);
    const matching_binds = binds
      .map((entry, index) => ({
        index,
        match: /^(.*):(\/[^:]*)(?::([^:]*))?$/.exec(entry),
      }))
      .filter(({ match }) => match?.[2] === item.Target);
    if (matches.length + matching_binds.length > 1)
      throw Error("Duplicate managed configuration mount target");
    if (matches.length) {
      if (
        matches[0].Type !== "bind" ||
        !same_source(matches[0].Source, item.Source)
      )
        throw Error("Conflicting managed configuration mount");
      mounts[mounts.indexOf(matches[0])] = { ...matches[0], ReadOnly: true };
    } else if (matching_binds.length) {
      const { index, match } = matching_binds[0];
      if (!same_source(match[1], item.Source))
        throw Error("Conflicting managed configuration bind");
      const options = (match[3] || "")
        .split(",")
        .filter((value) => value && !["ro", "rw"].includes(value));
      binds[index] =
        `${match[1]}:${item.Target}:${[...options, "ro"].join(",")}`;
    } else mounts.push({ ...item });
  }
  host.Mounts = mounts;
  if (host.Binds) host.Binds = binds;
  return { ...payload, HostConfig: host };
}

// Imported by the guarded adapter in the locally installed host controller.
export function apply_managed_configuration_mounts(
  payload,
  { root = ROOT, rehearsal = false } = {},
) {
  if (rehearsal) return payload;
  const contract = JSON.parse(
    fs.readFileSync(path.join(root, MOUNT_CONTRACT), "utf8"),
  );
  if (contract.schema_version !== 1)
    throw Error("Unsupported managed mount contract");
  return reconcile_managed_mounts(payload, contract.mounts);
}
