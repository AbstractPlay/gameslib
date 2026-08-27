/** @type {import('mocha').MochaOptions} */
module.exports = {
  // tsx handles .ts whether Mocha loads files via require or ESM import (CI shell glob expansion).
  require: ["tsx/cjs"],
  extension: ["ts"],
  spec: ["test/**/*.test.ts"],
};
