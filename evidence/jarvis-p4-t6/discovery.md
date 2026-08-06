# P4.T6 discovery — step evidence

The run API returns step type, status, attempts, updated time, terminal reason, and step ID. The receipt route accepts `workflowStepId`; receipt IDs are not present on the run-step row and must be resolved on demand. The active Thread is owned by the current document and must remain mounted while evidence opens.
