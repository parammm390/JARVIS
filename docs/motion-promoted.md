# JARVIS v3 promoted motion ledger

The complete vocabulary is `MOTION_SPECS` in
`src/components/jarvis/kernel/choreography.ts`. This ledger records all 18
specified motions and their current repository wiring; it does not promote a
catalog entry merely because a spec exists.

| ID | Name | Phase ledger | Current source evidence |
| --- | --- | --- | --- |
| M1 | RailCommit | P2 | `railCommitVariants` |
| M2 | ThreadBirth | P2 | `threadBirthVariants` |
| M3 | EchoResolve | P2 | Thread integration |
| M4 | ContextGather | P3 | `contextGatherChipVariants` |
| M5 | PlanDraw | P2/P3 | `planDrawNodeVariants` |
| M6 | PolicyClamp | P2 | Thread integration |
| M7 | CockpitRise | P2 | `cockpitRiseVariants` |
| M8 | BlastRadius | P5 | `blastRadiusDotVariants` |
| M9 | StampApprove | P2 | `stampApproveVariants` |
| M10 | ShatterReject | P2 | `shatterRejectVariants` |
| M11 | LiquidFill | P2 | reused WorkflowTheater graph; literal fill remains a recorded deviation |
| M12 | StepSpark | P2 | reused WorkflowTheater graph |
| M13 | DrainBack | P7 | existing amber reverse graph edge; literal fill remains unmeasured |
| M14 | FaultShake | P7 | specification exists; no P7 evidence yet |
| M15 | ReceiptSeal | P2 | `receiptSealVariants` |
| M16 | TruthReveal | P4 | `truthRevealActualVariants`, `truthRevealRowPulse` |
| M17 | FieldWarm | P4 | `fieldWarmExitVariants` |
| M18 | Relight | P7 | specification exists; no P7 evidence yet |

The P2/P3/P4/P5 exported arrays are source-of-truth phase records:
`P2_PROMOTED_MOTIONS`, `P3_PROMOTED_MOTIONS`, `P4_PROMOTED_MOTIONS`, and
`P5_PROMOTED_MOTIONS`. No additional motion is introduced by this document.
