import { describe,it,expect } from "vitest";
import { assessLiveFrame,assessPilotSimilarity } from "../../admin/face-pilot.mjs";

const example={embedding:[0.1,0.2,0.3],boxScore:0.9,real:0.85,live:0.8};
describe("non-authoritative local face pilot gates",()=>{
  it("rejects zero or multiple people",()=>{
    expect(assessLiveFrame([]).ready).toBe(false);
    expect(assessLiveFrame([example,example]).ready).toBe(false);
  });
  it("requires descriptors and anti-spoof/liveness confidence",()=>{
    expect(assessLiveFrame([{...example,embedding:[]}]).ready).toBe(false);
    expect(assessLiveFrame([{...example,real:undefined}]).ready).toBe(false);
    expect(assessLiveFrame([{...example,live:0.3}]).ready).toBe(false);
    expect(assessLiveFrame([{...example,boxScore:0.1}]).ready).toBe(false);
  });
  it("accepts a live face for the experiment only",()=>expect(assessLiveFrame([example]).ready).toBe(true));
  it("requires at least three passing frames and an adequate similarity",()=>{
    expect(assessPilotSimilarity(0.7,2)).toBe(false);
    expect(assessPilotSimilarity(0.54,4)).toBe(false);
    expect(assessPilotSimilarity(Number.NaN,4)).toBe(false);
    expect(assessPilotSimilarity(0.7,3)).toBe(true);
  });
});
