import assert from "node:assert/strict";
import test from "node:test";
import {
  asset_model_paths,
  expand_asset_files,
  ASSET_IMPORT_LIMIT,
} from "@fracto/sdk/FractoAssetArchive.js";

test("RAR-only uploads can defer model discovery while ordinary expansion remains strict", () => {
  const files = [{ path: "bush.rar", data: new Uint8Array([1, 2, 3]) }];
  const unzip = () => {
    throw Error("RAR must not use a ZIP decoder");
  };
  assert.throws(() => expand_asset_files(files, unzip), /no_model/);
  const result = expand_asset_files(files, unzip, { allow_no_model: true });
  assert.deepEqual(result.models, []);
  assert.equal(result.entries[0].path, "source/files/bush.rar");
  assert.equal(result.entries[0].data, files[0].data);
  assert.throws(
    () =>
      expand_asset_files(
        [{ path: "huge.rar", data: { byteLength: ASSET_IMPORT_LIMIT + 1 } }],
        unzip,
        { allow_no_model: true },
      ),
    /import_too_large/,
  );
});

test("model choices after codec expansion use the shared format order and safe paths", () => {
  const entries = [
    "source/extracted/bush/model.obj",
    "source/files/download.rar",
    "source/extracted/bush/model.fbx",
    "source/files/preview.glb",
  ].map((path) => ({ path }));
  assert.deepEqual(asset_model_paths(entries), [
    "source/files/preview.glb",
    "source/extracted/bush/model.fbx",
    "source/extracted/bush/model.obj",
  ]);
  assert.throws(
    () => asset_model_paths([{ path: "../outside.obj" }]),
    /unsafe_path/,
  );
  assert.throws(() => asset_model_paths([]), /no_model/);
});
