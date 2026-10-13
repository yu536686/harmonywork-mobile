export function desktopTaskPrompt(goal: string, originalRequest: string): string {
  const original = originalRequest.trim();
  const plan = goal.trim();
  const prefix = '用户原始要求（优先满足，尤其不要省略发送文件等交付方式）：\n';
  const originalPart = prefix + original;
  if ([...originalPart].length >= 8_000) return [...original].slice(0, 8_000).join('');
  const planPart = '\n\n手机端执行规划：\n' + plan;
  return originalPart + [...planPart].slice(0, 8_000 - [...originalPart].length).join('');
}
