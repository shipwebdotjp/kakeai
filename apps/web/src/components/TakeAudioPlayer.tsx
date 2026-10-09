import { useEffect, useRef, useState } from "react";
import { assetContentUrl } from "../api/client";
import { errorTextClass, buttonNeutralClass } from "../ui";

const players = new Map<object, (playing: boolean) => void>();
let sharedAudio: HTMLAudioElement | null = null;
let ownerId: object | null = null;

export function TakeAudioPlayer({ assetId }: { assetId: string }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);
  const idRef = useRef<object>({});

  useEffect(() => {
    const id = idRef.current;
    const setter = (value: boolean) => setPlaying(value);
    players.set(id, setter);
    return () => {
      players.delete(id);
      if (ownerId === id) {
        sharedAudio?.pause();
        sharedAudio = null;
        ownerId = null;
      }
    };
  }, []);

  const toggle = () => {
    const id = idRef.current;
    if (playing) {
      sharedAudio?.pause();
      setPlaying(false);
      if (ownerId === id) {
        ownerId = null;
      }
      return;
    }
    for (const setter of players.values()) {
      setter(false);
    }
    if (sharedAudio === null) {
      sharedAudio = new Audio();
    }
    const audio = sharedAudio;
    audio.pause();
    audio.src = assetContentUrl(assetId);
    audio.onended = () => {
      setPlaying(false);
      if (ownerId === id) {
        ownerId = null;
      }
    };
    audio.onerror = () => {
      setPlaying(false);
      setError(true);
      if (ownerId === id) {
        ownerId = null;
      }
    };
    ownerId = id;
    setError(false);
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        setPlaying(false);
        setError(true);
      });
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className={buttonNeutralClass} onClick={toggle}>
        {playing ? "停止" : "再生"}
      </button>
      {error && <span className={errorTextClass}>再生できません</span>}
    </span>
  );
}
