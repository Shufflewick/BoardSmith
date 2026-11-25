import { describe, it, expect } from "vitest";
import { worldAction, worldClockAction, type WorldAction } from "./action.js";
import { finishedActionMessage } from "../engine/action/action-builder.js";

const finishedMessage = (method: string) => finishedActionMessage("act", method);

const seatedCalls: Record<string, (action: WorldAction) => unknown> = {
  needs: (a) => a.needs(() => ["store"]),
  reads: (a) => a.reads(() => ["store"]),
  noticeBox: (a) => a.noticeBox(() => null),
  prompt: (a) => a.prompt("Act"),
  help: (a) => a.help("Acts"),
  condition: (a) => a.condition({ ok: () => true }),
  disabled: (a) => a.disabled(() => false),
  validate: (a) => a.validate(() => true),
  quote: (a) => a.quote(() => null),
  manual: (a) => a.manual(),
  destructive: (a) => a.destructive(),
  group: (a) => a.group("Menu"),
  order: (a) => a.order(1),
  chooseFrom: (a) => a.chooseFrom("x", { choices: ["a"] }),
  chooseElement: (a) => a.chooseElement("e", { elements: () => [] }),
  chooseElements: (a) => a.chooseElements("es", { elements: () => [] }),
  enterText: (a) => a.enterText("t"),
  enterNumber: (a) => a.enterNumber("n"),
  execute: (a) => a.execute(() => {}),
};

describe("a world action builder after .execute() (#1810)", () => {
  it.each(Object.keys(seatedCalls))("refuses .%s() at the call that makes the mistake", (method) => {
    const action = worldAction("act");
    action.execute(() => {});
    expect(() => seatedCalls[method]!(action)).toThrow(finishedMessage(method));
  });

  it("leaves a zero-pick action's rounds as .execute() placed them when .needs() comes late", () => {
    const claim = worldAction("act").needs(() => ["store"]).condition({ ok: () => true });
    const definition = claim.execute(() => {});
    expect(() => claim.needs(() => ["store"])).toThrow(finishedMessage("needs"));
    expect(definition.world!.needs.map((round) => round.before)).toEqual([0]);
  });

  it.each([
    ["needs", (a: ReturnType<typeof worldClockAction>) => a.needs(() => ["store"])],
    ["reads", (a: ReturnType<typeof worldClockAction>) => a.reads(() => ["store"])],
    ["about", (a: ReturnType<typeof worldClockAction>) => a.about(() => null)],
    ["noticeBox", (a: ReturnType<typeof worldClockAction>) => a.noticeBox(() => null)],
    ["prompt", (a: ReturnType<typeof worldClockAction>) => a.prompt("Tick")],
    ["execute", (a: ReturnType<typeof worldClockAction>) => a.execute(() => {})],
  ] as const)("refuses .%s() on a clock action", (method, call) => {
    const tick = worldClockAction("act");
    tick.execute(() => {});
    expect(() => call(tick)).toThrow(finishedMessage(method));
  });
});
