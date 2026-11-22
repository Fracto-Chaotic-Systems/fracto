# Shared SDK utilities

Consumers use these modules through exported `@fracto/sdk/utils/*.js` subpaths.
The SDK does not import a root/server implementation or own application data.

`AuthRequestOrigin.js` checks mutating request origins against the configured UI.
`ServiceAuthorization.js` provides common internal-token headers/verification and
enabled-user authorization using the root's documented `/auth/session` endpoint.
It preserves the existing authorization policy and bounded session-lookup timeout;
moving it here does not expand any API's personal-data authorization.
The root's old utility modules are compatibility exports through the npm package.

Other utilities in this directory provide shared file/stream algorithms; callers
own their input paths, storage lifecycle and service-specific policies.
