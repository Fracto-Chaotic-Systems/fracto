import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
   REQUIRED_LOCAL_TILE_LISTINGS,
   validate_ec2_compose_model,
   validate_local_tile_listings,
} from '../scripts/validate_ec2_deployment.js'

const valid_model = () => ({
   services: {
      fracto: {
         environment: {
            FRACTO_AUTH_REQUIRED: 'true',
            FRACTO_AUTH_MODE: 'oidc',
            FRACTO_AUTH_SECURE_COOKIES: 'true',
            FRACTO_OIDC_ISSUER: 'https://accounts.google.com',
            FRACTO_OIDC_CLIENT_ID: 'client-id',
            FRACTO_OIDC_CLIENT_SECRET: 'secret-value',
            FRACTO_OIDC_REDIRECT_URI: 'https://example.test/api/main/auth/callback',
            FRACTO_UI_ORIGIN: 'https://example.test/',
            FRACTO_TILE_SOURCE_MODE: 'local',
            FRACTO_TILE_SOURCE_DIR: '/mnt/fracto-tile-source',
            FRACTO_TILE_SOURCE_GENERATION: 'dataset-v1',
         },
         volumes: [{
            source: '/srv/fracto/tiles',
            target: '/mnt/fracto-tile-source',
            read_only: true,
         }],
      },
   },
})

test('EC2 Compose validation accepts HTTPS OIDC and a read-only local tile mount', () => {
   assert.equal(validate_ec2_compose_model(valid_model()), '/srv/fracto/tiles')
})

test('EC2 Compose validation rejects disabled authentication', () => {
   const model = valid_model()
   model.services.fracto.environment.FRACTO_AUTH_REQUIRED = 'false'
   assert.throws(() => validate_ec2_compose_model(model), /FRACTO_AUTH_REQUIRED=true/)
})

test('EC2 Compose validation rejects insecure public URLs and cookies', () => {
   const insecure_url = valid_model()
   insecure_url.services.fracto.environment.FRACTO_UI_ORIGIN = 'http://example.test/'
   assert.throws(() => validate_ec2_compose_model(insecure_url), /absolute HTTPS URL/)

   const insecure_cookie = valid_model()
   insecure_cookie.services.fracto.environment.FRACTO_AUTH_SECURE_COOKIES = 'false'
   assert.throws(() => validate_ec2_compose_model(insecure_cookie), /FRACTO_AUTH_SECURE_COOKIES=true/)
})

test('EC2 Compose validation rejects a writable tile mount and an invalid generation', () => {
   const writable_mount = valid_model()
   writable_mount.services.fracto.volumes[0].read_only = false
   assert.throws(() => validate_ec2_compose_model(writable_mount), /mounted read-only/)

   const invalid_generation = valid_model()
   invalid_generation.services.fracto.environment.FRACTO_TILE_SOURCE_GENERATION = '../dataset'
   assert.throws(() => validate_ec2_compose_model(invalid_generation), /stable 1-128 character identifier/)
})

test('local tile source preflight requires all listings consumed during index refresh', () => {
   const source_root = fs.mkdtempSync(path.join(os.tmpdir(), 'fracto-local-source-'))
   try {
      fs.mkdirSync(path.join(source_root, 'L02'))
      fs.mkdirSync(path.join(source_root, 'manifest'))
      REQUIRED_LOCAL_TILE_LISTINGS.forEach(name => {
         fs.writeFileSync(path.join(source_root, 'manifest', `${name}.csv`), 'short_code\n12\n')
      })
      assert.equal(validate_local_tile_listings(source_root), undefined)
      fs.unlinkSync(path.join(source_root, 'manifest', 'needs_update.csv'))
      assert.throws(
         () => validate_local_tile_listings(source_root),
         /readable manifest\/needs_update\.csv listing/,
      )
   } finally {
      fs.rmSync(source_root, {recursive: true, force: true})
   }
})
