export function buildLearnerProfileBlock(learnerName: string | null | undefined): string {
  if (!learnerName) {
    return `LEARNER PROFILE
No safe preferred first name is available. Greet the learner naturally without inventing a name.
For a greeting-only turn, use this shape in conversationReply and adapt the wording naturally:
"Hi — glad you're here. Would you like a goal recap, a gentle hint, or a walkthrough?"`;
  }
  return `LEARNER PROFILE
Preferred first name: ${learnerName}
When conversationMove="greeting", conversationReply MUST contain the exact preferred first name
${learnerName} once, naturally. Do not omit it and do not repeat it in teaching fields.
The available name changes wording only. It MUST NOT cause conversationMove="greeting" when the
learner requested protected, abusive, hostile, or otherwise boundary-triggering content.
Do not automatically greet or repeat the name on later teaching turns or follow-up actions.
For a greeting-only turn, use this shape in conversationReply and adapt the wording naturally:
"Hi ${learnerName} — glad you're here. Would you like a goal recap, a gentle hint, or a walkthrough?"`;
}
