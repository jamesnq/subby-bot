module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "infra-no-modules",
      severity: "error",
      from: { path: "^src/infrastructure" },
      to: { path: "^src/modules" },
    },
    {
      name: "shared-no-modules",
      severity: "error",
      from: { path: "^src/shared" },
      to: { path: "^src/modules" },
    },
    {
      name: "shared-no-infra",
      severity: "error",
      from: { path: "^src/shared" },
      to: { path: "^src/infrastructure" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: [
          "^src/modules/tools/",
          "^src/app\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    tsPreCompilationDeps: true,
  },
};
