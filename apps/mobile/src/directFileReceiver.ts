import { FILE_MAX_BYTES, parseFileFrame, validateNextChunk, type FileFrame } from './fileTransferProtocol.ts';

export type SharedAttachment = {
  id: string; name: string; mimeType: string; size: number; sha256: string;
  desktopDeviceId?: string; mobileDeviceId?: string; taskId?: string;
};

/** Serializes incoming DataChannel blocks into the Android cache and verifies before exposure. */
export class DirectFileReceiver {
  private active: { attachment: SharedAttachment; offset: number } | null = null;
  private chain: Promise<void> = Promise.resolve();
  private send: (frame: FileFrame) => boolean;
  private startNative: (attachment: SharedAttachment) => Promise<number>;
  private appendNative: (id: string, offset: number, bytes: string) => Promise<number>;
  private finishNative: (id: string) => Promise<unknown>;
  private abortNative: (id: string) => Promise<unknown>;
  private onReady: (id: string) => void;
  private onError: (id: string, message: string) => void;
  private onProgress: (id: string, received: number, total: number) => void;

  constructor(
    send: (frame: FileFrame) => boolean,
    startNative: (attachment: SharedAttachment) => Promise<number>,
    appendNative: (id: string, offset: number, bytes: string) => Promise<number>,
    finishNative: (id: string) => Promise<unknown>,
    abortNative: (id: string) => Promise<unknown>,
    onReady: (id: string) => void,
    onError: (id: string, message: string) => void,
    onProgress: (id: string, received: number, total: number) => void = () => undefined,
  ) {
    this.send = send;
    this.startNative = startNative;
    this.appendNative = appendNative;
    this.finishNative = finishNative;
    this.abortNative = abortNative;
    this.onReady = onReady;
    this.onError = onError;
    this.onProgress = onProgress;
  }

  get activeAttachmentId(): string | null { return this.active?.attachment.id ?? null; }

  async begin(attachment: SharedAttachment, ticket: string): Promise<void> {
    if (!Number.isSafeInteger(attachment.size) || attachment.size < 0 || attachment.size > FILE_MAX_BYTES ||
      !/^[0-9a-f]{64}$/i.test(attachment.sha256)) throw new Error('附件元数据无效');
    await this.pause();
    const offset = await this.startNative(attachment);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > attachment.size) throw new Error('附件缓存状态无效');
    this.active = { attachment, offset };
    const request = parseFileFrame({ type: 'request', attachmentId: attachment.id, ticket, offset });
    if (!this.send(request)) {
      await this.pause();
      this.onError(attachment.id, '电脑直连不可用，可重试续传');
      throw new Error('电脑直连不可用，请重试');
    }
  }

  onFrame(raw: FileFrame): Promise<void> {
    this.chain = this.chain.then(() => this.process(raw)).catch(async () => {
      const id = this.active?.attachment.id;
      if (id) await this.fail(id, '附件传输失败，请重试');
    });
    return this.chain;
  }

  async cancel(): Promise<void> {
    const id = this.active?.attachment.id;
    this.active = null;
    if (id) {
      this.send({ type: 'cancel', attachmentId: id });
      await this.abortNative(id).catch(() => undefined);
    }
  }

  private async pause(): Promise<void> {
    const id = this.active?.attachment.id;
    this.active = null;
    if (id) this.send({ type: 'cancel', attachmentId: id });
  }

  async disconnected(): Promise<void> {
    const id = this.active?.attachment.id;
    if (id) {
      await this.pause();
      this.onError(id, '电脑直连已断开，可重新获取并续传');
    }
  }

  private async fail(id: string, message: string): Promise<void> {
    await this.cancel();
    this.onError(id, message);
  }

  private async process(raw: FileFrame): Promise<void> {
    const frame = parseFileFrame(raw);
    const current = this.active;
    if (!current || frame.attachmentId !== current.attachment.id) return;
    if (frame.type === 'error') {
      if (frame.code === 'not_authorized') {
        await this.pause();
        this.onError(frame.attachmentId, '附件授权已失效，可重新取票续传');
      } else await this.fail(frame.attachmentId, '附件传输失败，请重试');
      return;
    }
    if (frame.type === 'data') {
      const next = validateNextChunk(current.offset, frame);
      if (next > current.attachment.size) throw new Error('File exceeds declared size');
      const written = await this.appendNative(frame.attachmentId, frame.offset, frame.bytes);
      if (written !== next) throw new Error('Cache offset mismatch');
      current.offset = next;
      this.onProgress(frame.attachmentId, next, current.attachment.size);
      if (!this.send({ type: 'ack', attachmentId: frame.attachmentId, offset: next })) {
        throw new Error('Direct connection lost');
      }
      return;
    }
    if (frame.type === 'complete') {
      if (frame.size !== current.attachment.size || frame.size !== current.offset ||
        frame.sha256.toLowerCase() !== current.attachment.sha256.toLowerCase()) {
        throw new Error('File completion mismatch');
      }
      await this.finishNative(frame.attachmentId);
      this.active = null;
      this.onReady(frame.attachmentId);
    }
  }
}
