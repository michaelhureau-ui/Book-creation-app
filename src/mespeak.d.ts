/** meSpeak ships no types; only the three calls the voice uses are declared. */
declare module 'mespeak' {
  interface MeSpeak {
    loadConfig: (config: unknown) => void
    loadVoice: (voice: unknown) => void
    speak: (text: string, options: Record<string, unknown>) => ArrayBuffer | null
  }
  const meSpeak: MeSpeak
  export default meSpeak
}
