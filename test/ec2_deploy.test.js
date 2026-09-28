import assert from 'node:assert/strict'
import test from 'node:test'

import {validate_ec2_compose_model} from '../scripts/validate_ec2_deployment.js'

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
