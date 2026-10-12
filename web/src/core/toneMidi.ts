import * as ToneMidi from '@tonejs/midi'

/** @tonejs/midi es CommonJS: en Node ESM la clase llega en `default`, con Vite como export con nombre. */
type MidiModule = typeof ToneMidi
const mod = ToneMidi as MidiModule & { default?: MidiModule }
export const Midi: MidiModule['Midi'] = mod.Midi ?? mod.default!.Midi
export type Midi = InstanceType<MidiModule['Midi']>
