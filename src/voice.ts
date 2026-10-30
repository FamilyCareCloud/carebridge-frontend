// Microphone recording helpers for CareBridge workspace transcriptions.
// Lambda caps the complete JSON body at 4 MiB; base64 expands raw audio by 4/3.
export const AUDIO_MAX_BYTES = 3 * 1024 * 1024 - 1024;

const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return CANDIDATE_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("오디오를 읽지 못했습니다."));
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

// getUserMedia rejects with a DOMException whose message is raw English ("The object can not be found here."
// when no input device exists). Map it to something a caregiver can act on.
export function micErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "사용할 수 있는 마이크를 찾지 못했어요. 마이크가 연결돼 있는지 확인하거나, 텍스트로 질문해 주세요.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "마이크 사용이 허용되지 않았어요. 주소창의 사이트 설정에서 마이크를 허용한 뒤 다시 시도해 주세요.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "마이크를 사용할 수 없어요. 다른 프로그램이 마이크를 쓰고 있는지 확인해 주세요.";
  }
  return "마이크를 시작하지 못했어요. 텍스트로 질문해 주세요.";
}

export type Recorder = {
  stop: () => Promise<{ blob: Blob; mimeType: string }>;
  cancel: () => void;
};

export async function startRecording(): Promise<Recorder> {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) {
    throw new Error("이 브라우저에서는 음성 녹음을 지원하지 않습니다.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    throw new Error(micErrorMessage(e));
  }
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  recorder.start();
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.onerror = () => {
          stopTracks();
          reject(new Error("녹음 중 오류가 발생했습니다."));
        };
        recorder.onstop = async () => {
          stopTracks();
          try {
            const recorded = new Blob(chunks, { type: mimeType ?? recorder.mimeType });
            if (!recorded.size) throw new Error("녹음된 소리가 없어요. 다시 녹음해 주세요.");
            const blob = await toPcmWav(recorded);
            resolve({ blob, mimeType: "audio/wav" });
          } catch { reject(new Error("녹음 파일을 변환하지 못했습니다. 짧게 다시 녹음해 주세요.")); }
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      recorder.stop();
      stopTracks();
    },
  };
}

// The STT decoder accepts PCM WAV reliably; browser WebM/Opus may fail server decoding.
export async function toPcmWav(blob: Blob): Promise<Blob> {
  const decoder = new AudioContext();
  let decoded: AudioBuffer;
  try { decoded = await decoder.decodeAudioData(await blob.arrayBuffer()); }
  finally { await decoder.close(); }
  const length = Math.ceil(decoded.duration * 16000);
  if (!length || 44 + length * 2 > AUDIO_MAX_BYTES) throw new Error("녹음이 너무 깁니다.");
  const offline = new OfflineAudioContext(1, length, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const tag = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  tag(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); view.setInt16(44 + i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true); }
  return new Blob([buffer], { type: "audio/wav" });
}
