import { useState, useRef } from 'react';
import { MachineProfile, PRESET_MACHINES } from '../components/MachineSelector';
import { detectMachine } from '../lib/detectMachine';

export function useMachineHint({
  selectedMachine,
  setSelectedMachine,
}: {
  selectedMachine: MachineProfile;
  setSelectedMachine: React.Dispatch<React.SetStateAction<MachineProfile>>;
}) {
  const [machineHint, setMachineHint] = useState<{ preset: MachineProfile; auto: boolean } | null>(null);
  const dismissedMachines = useRef<Set<string>>(new Set());
  const prevMachineRef = useRef<MachineProfile | null>(null);

  const processMachineDetection = (text: string): MachineProfile | undefined => {
    let machineForRequest: MachineProfile | undefined;
    const det = detectMachine(text);
    if (det && det.presetId !== selectedMachine.id && !dismissedMachines.current.has(det.presetId)) {
      const preset = PRESET_MACHINES.find(p => p.id === det.presetId);
      if (preset) {
        if (selectedMachine.id === 'univ-all' && det.specific) {
          prevMachineRef.current = selectedMachine;
          setSelectedMachine(preset);
          machineForRequest = preset;
          setMachineHint({ preset, auto: true });
        } else {
          setMachineHint({ preset, auto: false });
        }
      }
    }
    return machineForRequest;
  };

  const applyMachineHint = () => {
    if (!machineHint) return;
    prevMachineRef.current = selectedMachine;
    setSelectedMachine(machineHint.preset);
    dismissedMachines.current.delete(machineHint.preset.id);
    setMachineHint(null);
  };

  const undoMachineHint = () => {
    if (machineHint?.auto && prevMachineRef.current) setSelectedMachine(prevMachineRef.current);
    if (machineHint) dismissedMachines.current.add(machineHint.preset.id);
    setMachineHint(null);
  };

  const dismissMachineHint = () => {
    if (machineHint) dismissedMachines.current.add(machineHint.preset.id);
    setMachineHint(null);
  };

  return {
    machineHint,
    setMachineHint,
    processMachineDetection,
    applyMachineHint,
    undoMachineHint,
    dismissMachineHint,
  };
}

export default useMachineHint;
