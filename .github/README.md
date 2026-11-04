# Repository automation

`workflows/validate.yml` checks the root SDK and integrated service contracts.
Fracto uses independent service repositories; CI must check them out alongside
the root before running tests that import their modules.
