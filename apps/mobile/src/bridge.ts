const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

export type PairingCode = { pairingId: string; secret: string };
export type LinkedDevice = {
  desktopDeviceId: string;
  mobileDeviceId: string;
  desktopName: string;
  mobileName: string;
};
export type RemoteTask = {
  id: string;
  sessionId: string;
  desktopDeviceId: string;
  prompt: string;
  status: 'queued' | 'claimed' | 'succeeded' | 'failed';
  result: string | null;
  createdAt: string;
  updatedAt: string;
};

export function parsePairingCode(raw: string): PairingCode {
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new Error('请扫描桌面端显示的 Harmony Work 配对二维码'); }
  if (url.protocol !== 'harmonywork:' || url.hostname !== 'pair' || url.pathname !== '' && url.pathname !== '/') {
    throw new Error('这不是 Harmony Work 的配对二维码');
  }
  const pairingId = url.searchParams.get('id') ?? '';
  const secret = url.searchParams.get('secret') ?? '';
  if (!uuidPattern.test(pairingId) || !secretPattern.test(secret)) {
    throw new Error('配对二维码内容无效');
  }
  return { pairingId, secret };
}
