/** Adobe Premiere tick helpers. 254016000000 ticks = 1 second. */

export const TICKS_PER_SECOND = 254016000000n;

export type TimebaseInfo = {
  ticksPerFrame: bigint;
  fps: number;
};

/** Default 24fps if sequence timebase unavailable. */
export function defaultTimebase(): TimebaseInfo {
  const ticksPerFrame = TICKS_PER_SECOND / 24n;
  return { ticksPerFrame, fps: 24 };
}

export function frameToTicks(frame: number, tpf: bigint): string {
  const f = Math.max(0, Math.floor(Number(frame)));
  return String(BigInt(f) * tpf);
}

export function ticksToFrame(ticks: string | number | bigint, tpf: bigint): number {
  return Number(BigInt(String(ticks)) / tpf);
}

export function ticksToSeconds(ticks: string | number | bigint): number {
  return Number(BigInt(String(ticks))) / Number(TICKS_PER_SECOND);
}

type Relay = { call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown> };

/**
 * Resolve ticks-per-frame from plugin (new handlers) or fall back to 24fps.
 * After plugin reload, sequence.getTimebase / playhead.get expose accurate values.
 */
export async function resolveTimebase(relay: Relay, sequenceId?: string): Promise<TimebaseInfo> {
  try {
    const tb = (await relay.call("sequence.getTimebase", sequenceId ? { sequenceId } : {})) as {
      ticksPerFrame?: string;
      fps?: number;
    };
    if (tb?.ticksPerFrame) {
      const ticksPerFrame = BigInt(String(tb.ticksPerFrame));
      if (ticksPerFrame > 0n) {
        return {
          ticksPerFrame,
          fps: tb.fps ?? Number(TICKS_PER_SECOND) / Number(ticksPerFrame),
        };
      }
    }
  } catch {
    /* older plugin */
  }

  try {
    const settings = (await relay.call("sequence.getSettings", sequenceId ? { sequenceId } : {})) as {
      timebaseTicksPerFrame?: string;
      videoFrameRate?: number;
    };
    if (settings?.timebaseTicksPerFrame) {
      const ticksPerFrame = BigInt(String(settings.timebaseTicksPerFrame));
      if (ticksPerFrame > 0n) {
        return {
          ticksPerFrame,
          fps: Number(TICKS_PER_SECOND) / Number(ticksPerFrame),
        };
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const pos = (await relay.call("playhead.get", sequenceId ? { sequenceId } : {})) as {
      ticksPerFrame?: string;
      fps?: number;
    };
    if (pos?.ticksPerFrame) {
      const ticksPerFrame = BigInt(String(pos.ticksPerFrame));
      if (ticksPerFrame > 0n) {
        return {
          ticksPerFrame,
          fps: pos.fps ?? Number(TICKS_PER_SECOND) / Number(ticksPerFrame),
        };
      }
    }
  } catch {
    /* ignore */
  }

  return defaultTimebase();
}

/** Move playhead using new plugin methods when available, else playhead.set + ticks. */
export async function goToFrame(
  relay: Relay,
  opts: { sequenceId?: string; frame: number },
): Promise<{ atTicks: string; frame: number; ticksPerFrame: string; via: string }> {
  try {
    const data = (await relay.call("playhead.setFrame", {
      sequenceId: opts.sequenceId,
      frame: opts.frame,
    })) as { atTicks: string; frame: number; ticksPerFrame: string };
    return { ...data, via: "playhead.setFrame" };
  } catch {
    const tb = await resolveTimebase(relay, opts.sequenceId);
    const atTicks = frameToTicks(opts.frame, tb.ticksPerFrame);
    await relay.call("playhead.set", { sequenceId: opts.sequenceId, atTicks });
    return {
      atTicks,
      frame: Math.max(0, Math.floor(opts.frame)),
      ticksPerFrame: String(tb.ticksPerFrame),
      via: "playhead.set+server-timebase",
    };
  }
}

export async function stepFrames(
  relay: Relay,
  opts: { sequenceId?: string; deltaFrames: number },
): Promise<{ atTicks: string; frame: number; ticksPerFrame: string; via: string }> {
  try {
    const data = (await relay.call("playhead.stepFrames", {
      sequenceId: opts.sequenceId,
      deltaFrames: opts.deltaFrames,
    })) as { atTicks: string; frame: number; ticksPerFrame: string };
    return { ...data, via: "playhead.stepFrames" };
  } catch {
    const pos = (await relay.call("playhead.get", opts.sequenceId ? { sequenceId: opts.sequenceId } : {})) as {
      ticks: string;
    };
    const tb = await resolveTimebase(relay, opts.sequenceId);
    const curFrame = ticksToFrame(pos.ticks, tb.ticksPerFrame);
    const next = Math.max(0, curFrame + Math.trunc(opts.deltaFrames));
    return goToFrame(relay, { sequenceId: opts.sequenceId, frame: next });
  }
}
