export const PLAN_ACTION_MARKER = "<!-- diffuin:implement-plan -->";
export const PLAN_ACTION_LABEL = "Create a pull request to implement this plan and close this issue when merged.";

export function renderPlanAction(): string {
  return `${PLAN_ACTION_MARKER}\n- [ ] ${PLAN_ACTION_LABEL}`;
}

export function isPlanActionChecked(previousBody: string, currentBody: string): boolean {
  return hasPlanAction(previousBody, false) && hasPlanAction(currentBody, true);
}

function hasPlanAction(body: string, checked: boolean): boolean {
  if (!body.includes(PLAN_ACTION_MARKER)) return false;
  const state = checked ? "[x]" : "[ ]";
  return body.toLowerCase().includes(`- ${state} ${PLAN_ACTION_LABEL}`.toLowerCase());
}
