// Workflow engine implementation lives in domain-plugins/shared (plugins use it too;
// they must not import orchestration). Re-exported here for orchestration consumers.
export * from "../../domain-plugins/shared/workflow";
