import React, { useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  X, 
  Maximize, 
  CheckCircle2, 
  AlertTriangle, 
  History, 
  FileText, 
  ArrowRight,
  Edit2,
  Trash2,
  Calendar,
  User,
  Activity,
  Dumbbell,
  Copy,
  Plus,
  ArrowLeft
} from 'lucide-react';
import { Client, Machine, Trainer, WorkoutSession, ExerciseLog } from '../types';
import { processLegacyChart, extractMachineSettingsFromImage, OCRMachineSetting, ValidationSession, ValidationLog, sanitizeImportedSessions, OCRResult } from '../services/geminiService';
import { db } from '../firebase';
import { useActiveStudio } from '../ActiveStudioContext';
import { useToast } from '../contexts/ToastContext';
import { collection, writeBatch, doc, serverTimestamp, getDocs, query, where, increment } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn, parseSessionDate, parseMachineSettings } from '../lib/utils';
import { planLegacyImport } from '../lib/legacy-import-utils';
import { importedSessionsRollup } from '../lib/client-rollups';

interface ImporterProps {
  clients: Client[];
  machines: Machine[];
  trainers: Trainer[];
  initialClientId?: string;
  onComplete?: () => void;
}



const legacyMachineMap:Record<string, string>={
  "cx":"4 Way Neck",
  "hip add":"Hip Adduction",
  "hip abd":"Hip Abduction",
  "leg curl":"Leg Curl",
  "leg ext":"Leg Extension",
  "leg ext.":"Leg Extension",
  "leg press":"Leg Press",
  "pull down":"Pull Down",
  "chest press":"Chest Press",
  "comp row":"Compound Row",
  "comp. row":"Compound Row",
  "overhead":"Overhead Press",
  "pull over":"Seated Pull Over",
  "seated dip":"Seated Dip",
  "tricep ext":"Tricep Extension",
  "tricep ext.":"Tricep Extension",
  "bicep":"Biceps",
  "chest fly":"Chest/Pec Fly",
  "lateral raise":"Lateral Raise",
  "lumbar":"Lumbar Extension",
  "torso rotation":"Torso Rotation",
  "abs":"Seated Abdominals",
  "leg press/l":"Leg Press",
  "pd":"Pull Down",
  "cp":"Chest Press",
  "op":"Overhead Press",
  "sr":"Compound Row",
  "cf":"Chest/Pec Fly",
  "te":"Tricep Extension",
  "lr":"Lateral Raise"
};

const normalizeMachineName=(rawName:string):string=>{
  const clean=rawName.toLowerCase().trim().replace(/\s+/g,' ');
  if(legacyMachineMap[clean])return legacyMachineMap[clean];
  
  // Try partial matches for common abbreviations
  for(const [key,val] of Object.entries(legacyMachineMap)){
    if(clean===key || (clean.length > 2 && key.includes(clean)) || (key.length > 2 && clean.includes(key))){
      return val;
    }
  }
  
  return rawName.charAt(0).toUpperCase()+rawName.slice(1);
};

export function LegacyChartImporter({ clients, machines, trainers, initialClientId, onComplete }: ImporterProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const { activeStudioId } = useActiveStudio();
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId || '');
  const [expectedSessions, setExpectedSessions] = useState<number>(10);
  const [files, setFiles] = useState<{ name: string; base64: string; mimeType: string; previewUrl: string }[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isScanningSettings, setIsScanningSettings] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [scanPercentage, setScanPercentage] = useState(0);
  const [validationSessions, setValidationSessions] = useState<ValidationSession[]>([]);
  const [extractedSettings, setExtractedSettings] = useState<OCRMachineSetting[]>([]);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeProgress, setFinalizeProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement> | { target: { files: FileList | null } }) => {
    const files = e.target.files;
    if (files) {
      (Array.from(files) as File[]).forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64Content = (event.target?.result as string).split(',')[1];
          setFiles(prev => [...prev, {
            name: file.name,
            base64: base64Content,
            mimeType: file.type,
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
          }]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearFiles = () => {
    setFiles([]);
    setValidationSessions([]);
  };

  const runOCR = async () => {
    if (!selectedClientId || files.length === 0 || !expectedSessions) return;

    setIsScanning(true);
    setScanPercentage(0);
    setScanProgress('Initializing Distributed OCR Engine...');
    setValidationSessions([]);
    setExtractedSettings([]); // Clear previous results

    try {
      const allOcrResults: OCRResult[] = [];
      const imageFiles = files.map(f => ({ base64: f.base64, mimeType: f.mimeType }));
      
      // Process images one by one for maximum precision
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        setScanProgress(`Analyzing Page ${i + 1} of ${imageFiles.length}...`);
        setScanPercentage(Math.round(((i) / imageFiles.length) * 50)); // First 50% for sessions
        
        const result = await processLegacyChart([file], 12, i, imageFiles.length);
        allOcrResults.push(result);
      }

      setScanProgress('Extracting High-Precision Machine Settings...');
      // Use the specialized settings engine for better padding/seat data
      const settings = await extractMachineSettingsFromImage(imageFiles);
      setExtractedSettings(settings);
      setScanPercentage(90);

      setScanProgress('Consolidating Multi-Page Data...');

      // Reconstructed Merge Logic
      const sessionsMap: Record<number, ValidationSession> = {};

      allOcrResults.forEach(ocrResult => {
        // 1. Map over headers first to establish sessions
        ocrResult.sessionHeaders.forEach((header) => {
          const sNum = header.sessionNumber;
          
          let dateString = header.date?.trim();
          let isInferredDate = false;

          // Date Fallback Rule
          if (!dateString || dateString.toLowerCase() === 'confirm' || dateString === '0') {
              isInferredDate = true;
          }

          const trainerMatch = trainers.find(t => 
            t.initials.toLowerCase() === (header.trainer || '').toLowerCase()
          );

          if (!sessionsMap[sNum]) {
            sessionsMap[sNum] = {
              id: `v-sess-${sNum}-${Date.now()}-${Math.random()}`,
              sessionNumber: sNum,
              date: dateString || '',
              trainer: header.trainer || 'Legacy',
              trainerId: trainerMatch?.id || 'legacy-trainer',
              machines: [],
              isInferredDate
            };
          } else {
            // Update header data if we find a better one
            if (dateString && !sessionsMap[sNum].date) sessionsMap[sNum].date = dateString;
            if (trainerMatch && sessionsMap[sNum].trainerId === 'legacy-trainer') {
              sessionsMap[sNum].trainer = header.trainer || 'Legacy';
              sessionsMap[sNum].trainerId = trainerMatch.id;
            }
          }
        });

        // Stitch performances to headers
        ocrResult.performances.forEach(perf => {
          const sNum = perf.sessionNumber;
          
          if (!sessionsMap[sNum]) {
            sessionsMap[sNum] = {
              id: `v-sess-${sNum}-${Date.now()}-${Math.random()}`,
              sessionNumber: sNum,
              date: '',
              trainer: 'Legacy',
              trainerId: 'legacy-trainer',
              machines: [],
              isInferredDate: true
            };
          }

          const repStr = String(perf.reps || '').toLowerCase().trim();
          if (repStr === '.' || repStr === '-' || repStr === '' || repStr === '0' || perf.reps === undefined) {
            return; 
          }

          let finalReps: number | string = Number(perf.reps) || 0;
          let isTSC = perf.isStaticHold || false;
          
          if (repStr.includes('s') || repStr.includes('sec') || repStr.includes('hold')) {
            isTSC = true;
            const match = repStr.match(/\d+/);
            if (match) finalReps = parseInt(match[0], 10);
          } else if (Number(perf.reps) > 20 || repStr.includes('sh')) {
            isTSC = true;
          }

          const rawMachineName = perf.machineName;
          const normalizedName = normalizeMachineName(rawMachineName);

          const machineMatch = machines.find(mach => 
            mach.name.toLowerCase() === normalizedName.toLowerCase() ||
            normalizedName.toLowerCase().includes(mach.name.toLowerCase()) ||
            mach.name.toLowerCase().includes(normalizedName.toLowerCase())
          );

          // Prevent duplicate logs for same machine in same session (merging artifacts)
          const existingMachineLog = sessionsMap[sNum].machines.find(m => m.machineId === machineMatch?.id && m.name === normalizedName);
          if (existingMachineLog) return;

          sessionsMap[sNum].machines.push({
            id: `v-log-${sNum}-${perf.machineName}-${Date.now()}-${Math.random()}`,
            name: normalizedName,
            rawName: rawMachineName,
            settings: perf.settings,
            weight: Number(perf.weight) || 0,
            reps: finalReps,
            isStaticHold: isTSC,
            timeUnderLoad: isTSC ? (Number(finalReps) || 90) : 0,
            machineId: machineMatch?.id,
            isAnomalous: !machineMatch,
            anomalyReason: !machineMatch ? `Unknown Machine: ${normalizedName}` : undefined
          });
        });
      });

      // 3. Convert to sorted array
      let mappedSessions = Object.values(sessionsMap).sort((a, b) => a.sessionNumber - b.sessionNumber);

      // Apply Date Fallback and One Session Per Day Rules using Chronology Engine
      mappedSessions = sanitizeImportedSessions(mappedSessions);

      // AGGREGATION: We now rely more on the specialized extractMachineSettingsFromImage call,
      // but we can still pull strings from performances as a fallback if needed.
      // (Skipping fallback for now to keep things clean, as the specialized call is better)

      setValidationSessions(mappedSessions);
      setScanPercentage(100);
      setScanProgress('OCR Pipeline Complete');
    } catch (err: any) {
      console.error(err);
      toastError(err.message || 'Engine Failure: Check Logs');
      setScanProgress('Engine Failure: Check Logs');
    } finally {
      setIsScanning(false);
    }
  };

  const runSettingsOCR = async () => {
    if (!selectedClientId || files.length === 0) return;

    setIsScanningSettings(true);
    setScanProgress('Scanning Settings Column Across All Images...');
    setValidationSessions([]); // Explicitly clear sessions if doing settings only
    
    try {
      const imageFiles = files.map(f => ({ base64: f.base64, mimeType: f.mimeType }));
      const settings = await extractMachineSettingsFromImage(imageFiles);
      setExtractedSettings(settings);
      setScanProgress('Settings Extraction Complete');
    } catch (err: any) {
      console.error(err);
      toastError(err.message || 'Settings Extraction Failed');
      setScanProgress('Settings Extraction Failed');
    } finally {
      setIsScanningSettings(false);
    }
  };

  const updateLogData = (sessionId: string, logId: string, field: string, value: any) => {
    setValidationSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      return {
        ...s,
        hasConflict: false, // Clear conflict warning upon edit
        machines: s.machines.map(l => {
          if (l.id !== logId) return l;
          return { ...l, [field]: value };
        })
      };
    }));
  };

  const duplicateLog = (sessionId: string, logId: string) => {
    setValidationSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const logToDup = s.machines.find(l => l.id === logId);
      if (!logToDup) return s;
      
      const newLog = { 
        ...logToDup, 
        id: `v-log-dup-${Date.now()}-${Math.random()}`,
        name: logToDup.name.includes('(Set 2)') ? logToDup.name : `${logToDup.name} (Set 2)`
      };
      
      return {
        ...s,
        machines: [...s.machines, newLog]
      };
    }));
  };

  const finalizeImport = async () => {
    if (!selectedClientId || isFinalizing) return;
    setIsFinalizing(true);
    setFinalizeProgress(0);

    try {
      // Empty grid columns must not become sessions — see planLegacyImport.
      const plan = planLegacyImport(validationSessions);
      const { sessionsToImport } = plan;
      const skippedEmptyCount = plan.skippedEmptySessionNumbers.length;

      if (sessionsToImport.length === 0) {
        toastError('No sessions contain exercise data. Nothing to import.');
        setIsFinalizing(false);
        return;
      }

      // Calculate total operations to track progress
      // 1 for each session, 1 for each log, 1 for client update, potentially many for settings
      const totalSessions = sessionsToImport.length;
      const totalLogs = plan.totalLogs;
      const allMachineIds = new Set<string>();
      extractedSettings.forEach(s => allMachineIds.add(s.machineId));
      for (const vSess of sessionsToImport) {
        vSess.machines.forEach(m => { if (m.machineId) allMachineIds.add(m.machineId); });
      }
      const totalSettings = allMachineIds.size;
      const totalOps = totalSessions + totalLogs + 1 + totalSettings;
      
      let completedOps = 0;
      const updateProgress = () => {
        completedOps++;
        setFinalizeProgress(Math.min(Math.round((completedOps / totalOps) * 100), 99));
      };

      const MAX_BATCH_SIZE = 450; // Safety margin below 500
      let currentBatch = writeBatch(db);
      let opCount = 0;

      const commitBatchIfNeeded = async (force = false) => {
        if (opCount >= MAX_BATCH_SIZE || (force && opCount > 0)) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          opCount = 0;
        }
      };
      
      // 1. Process Sessions & Logs
      for (const vSess of sessionsToImport) {
        const sessionRef = doc(collection(db, 'sessions'));
        
        let formattedDate = vSess.date;
        if (vSess.date) {
          const timestamp = parseSessionDate(vSess.date);
          if (timestamp > 0) {
            const dateObj = new Date(timestamp);
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd = String(dateObj.getDate()).padStart(2, '0');
            const yyyy = dateObj.getFullYear();
            formattedDate = `${yyyy}-${mm}-${dd}`;
          }
        }

        const fallbackDate = () => {
          const now = new Date();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        };

        // In the context of Legacy Import, we'll assume it happened at the target student's home studio or currently active studio
        const hostedAtStudioId = activeStudioId || 'legacy';

        const sessionData: WorkoutSession = {
          clientId: selectedClientId,
          hostedAtStudioId,
          clientHomeStudioId: hostedAtStudioId, // Defaulting to the same for legacy
          isCrossTrain: false,
          sessionType: 'Standard',
          sessionNumber: vSess.sessionNumber,
          date: formattedDate || fallbackDate(),
          trainerInitials: vSess.trainer,
          trainerId: vSess.trainerId || 'legacy-trainer',
          status: 'Completed',
          createdAt: serverTimestamp(),
          endTime: serverTimestamp()
        };
        
        currentBatch.set(sessionRef, sessionData);
        opCount++;
        updateProgress();
        await commitBatchIfNeeded();

        for (const vLog of vSess.machines) {
          if (!vLog.machineId) continue;
          const logRef = doc(collection(db, 'exerciseLogs'));
          const logData: ExerciseLog = {
            sessionId: sessionRef.id,
            clientId: selectedClientId,
            machineId: vLog.machineId,
            weight: String(vLog.weight),
            reps: vLog.isStaticHold ? '' : String(vLog.reps || ''),
            seconds: vLog.isStaticHold ? String(vLog.timeUnderLoad || '') : '',
            isTSC: vLog.isStaticHold,
            isStaticHold: vLog.isStaticHold,
            machineSettings: vLog.settings ? parseMachineSettings(vLog.settings) : {},
            // Left unset intentionally: legacy paper charts never recorded a
            // rep-quality rating, so hardcoding one here (this used to be a
            // blanket `repQuality: 2`) made every imported set render as a
            // fake "good" (amber) quality dot/tint in the Active Session and
            // History views, indistinguishable from a real trainer-entered
            // rating. Omitting the field leaves these sets showing as
            // "no quality recorded" instead.
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            studioId: hostedAtStudioId,
            homeStudioId: hostedAtStudioId,
            clientHomeStudioId: hostedAtStudioId
          };
          currentBatch.set(logRef, logData);
          opCount++;
          updateProgress();
          await commitBatchIfNeeded();
        }
      }

      // 2. Update client session count and profile
      const maxSessionNum = plan.highestSessionNumber;
      
      let totalImportedReps = 0;
      let totalImportedVolume = 0;

      sessionsToImport.forEach(vSess => {
        vSess.machines.forEach(vLog => {
          if (!vLog.machineId) return;
          
          let reps = 0;
          if (vLog.isStaticHold) {
            const seconds = Number(vLog.timeUnderLoad) || 0;
            reps = seconds <= 0 ? 0 : (seconds / 30) * 2;
          } else {
            reps = Number(vLog.reps) || 0;
          }

          const weightNum = Number(vLog.weight) || 0;
          let volume = 0;
          if (vLog.isStaticHold) {
            const seconds = Number(vLog.timeUnderLoad) || 0;
            const eqReps = seconds <= 0 ? 0 : (seconds / 30) * 2;
            volume = weightNum * eqReps;
          } else {
            const r = Number(vLog.reps) || 0;
            const repsForVol = r <= 0 ? 1 : r;
            volume = weightNum * repsForVol;
          }

          totalImportedReps += reps;
          totalImportedVolume += volume;
        });
      });

      const roundedImportedReps = Math.round(totalImportedReps);
      const roundedImportedVolume = Math.round(totalImportedVolume);

      const clientRef = doc(db, 'clients', selectedClientId);
      const clientUpdateObj: any = {
        completedSessions: increment(sessionsToImport.length),
        sessionCount: maxSessionNum,
        updatedAt: serverTimestamp()
      };

      if (roundedImportedReps > 0) {
        clientUpdateObj.lifetimeReps = increment(roundedImportedReps);
      }
      if (roundedImportedVolume > 0) {
        clientUpdateObj.lifetimeWeight = increment(roundedImportedVolume);
      }

      // Build currentMachineMetrics from imported data so profile cards and live sessions auto-populate weights
      const targetClient = clients.find(c => c.id === selectedClientId);

      // Top Trainer tally + per-machine lifetime stats (Sep 2026). The chart
      // parser already resolved each column's trainer (trainerId / initials),
      // so every imported session casts its vote here; sessions whose coach
      // could not be identified are simply not counted.
      Object.assign(
        clientUpdateObj,
        importedSessionsRollup(
          targetClient,
          sessionsToImport.map(vSess => ({
            date: vSess.date,
            trainerId: vSess.trainerId || 'legacy-trainer',
            trainerInitials: vSess.trainer,
            logs: vSess.machines
              .filter(vLog => !!vLog.machineId)
              .map(vLog => ({
                machineId: vLog.machineId,
                weight: vLog.weight,
                reps: vLog.isStaticHold ? null : vLog.reps,
                seconds: vLog.isStaticHold ? vLog.timeUnderLoad : null,
              })),
          })),
          trainers,
          { increment, serverTimestamp },
        ),
      );
      const currentMachineMetrics: Record<string, any> = {
        ...(targetClient?.currentMachineMetrics || {})
      };

      const cleanSettingVal = (val: any): string | null => {
        if (!val) return null;
        const str = String(val).trim();
        const noise = ['PROJECT', 'CONFIRM', 'UNKNOWN', 'LEGACY', 'CHART', 'GENERAL', 'NONE', 'NULL', 'UNDEFINED'];
        if (noise.includes(str.toUpperCase())) return null;
        if (/^[a-zA-Z\s]{4,}$/.test(str)) return null; // Reject full descriptive words
        return str;
      };

      const sanitizeSettingsMap = (raw: Record<string, any>): Record<string, string> => {
        const cleaned: Record<string, string> = {};
        Object.entries(raw || {}).forEach(([k, v]) => {
          const validVal = cleanSettingVal(v);
          if (validVal && k && !['project', 'notes', 'general', 'unknown'].includes(k.toLowerCase())) {
            cleaned[k] = validVal;
          }
        });
        return cleaned;
      };

      const sortedSess = [...sessionsToImport].sort((a, b) => (a.sessionNumber || 0) - (b.sessionNumber || 0));
      if (sortedSess.length > 0) {
        const latestSess = sortedSess[sortedSess.length - 1];
        if (latestSess.date) {
          clientUpdateObj.lastSessionDate = latestSess.date;
          clientUpdateObj.lastWorkoutDate = latestSess.date;
        }
      }
      for (const vSess of sortedSess) {
        let sessDate: any = serverTimestamp();
        if (vSess.date) {
          const parsed = parseSessionDate(vSess.date);
          if (parsed > 0) sessDate = new Date(parsed);
        }

        for (const vLog of vSess.machines) {
          if (!vLog.machineId) continue;
          if (!vLog.weight && !vLog.reps && !vLog.timeUnderLoad) continue;

          const extracted = extractedSettings.find(s => s.machineId === vLog.machineId);
          const rawSettingsObj: Record<string, string> = (extracted && extracted.rawSettings && Object.keys(extracted.rawSettings).length > 0)
            ? { ...extracted.rawSettings }
            : (vLog.settings ? parseMachineSettings(vLog.settings) : (currentMachineMetrics[vLog.machineId]?.settings || {}));

          if (extracted) {
            if (extracted.seat) rawSettingsObj['Seat'] = extracted.seat;
            if (extracted.gap) rawSettingsObj['Gap'] = extracted.gap;
            if (extracted.backPad) rawSettingsObj['Back Pad'] = extracted.backPad;
            if (extracted.handles) rawSettingsObj['Handles'] = extracted.handles;
            if (extracted.armPad) rawSettingsObj['Arm Pad'] = extracted.armPad;
          }

          const finalSettings = sanitizeSettingsMap(rawSettingsObj);

          currentMachineMetrics[vLog.machineId] = {
            weight: String(vLog.weight || '0'),
            reps: vLog.isStaticHold ? '' : String(vLog.reps || ''),
            seconds: vLog.isStaticHold ? String(vLog.timeUnderLoad || '') : '',
            isStaticHold: Boolean(vLog.isStaticHold),
            isTSC: Boolean(vLog.isStaticHold),
            settings: finalSettings,
            lastPerformedDate: sessDate,
            lastPerformedSessionNumber: vSess.sessionNumber
          };
        }
      }

      // Also ensure machines from extracted settings with currentWeight get recorded
      for (const extracted of extractedSettings) {
        if (!extracted.machineId) continue;
        if (!currentMachineMetrics[extracted.machineId]) {
          const finalSettings: Record<string, string> = { ...(extracted.rawSettings || {}) };
          if (extracted.seat) finalSettings['Seat'] = extracted.seat;
          if (extracted.gap) finalSettings['Gap'] = extracted.gap;
          if (extracted.backPad) finalSettings['Back Pad'] = extracted.backPad;
          if (extracted.handles) finalSettings['Handles'] = extracted.handles;
          if (extracted.armPad) finalSettings['Arm Pad'] = extracted.armPad;

          if (extracted.currentWeight || Object.keys(finalSettings).length > 0) {
            currentMachineMetrics[extracted.machineId] = {
              weight: String(extracted.currentWeight || '0'),
              reps: '',
              seconds: '',
              isStaticHold: false,
              isTSC: false,
              settings: finalSettings,
              lastPerformedDate: serverTimestamp()
            };
          }
        }
      }

      if (Object.keys(currentMachineMetrics).length > 0) {
        clientUpdateObj.currentMachineMetrics = currentMachineMetrics;
      }

      currentBatch.update(clientRef, clientUpdateObj);
      opCount++;
      updateProgress();
      await commitBatchIfNeeded();

      // 3. Save Global Machine Settings & Aggregated Data
      const machineWeightEntries: Record<string, { weight: number; timestamp: number; sessionIndex: number }[]> = {};
      
      let sessionIndex = 0;
      for (const vSess of sessionsToImport) {
        let timestamp = Date.now();
        if (vSess.date) {
            const parsed = parseSessionDate(vSess.date);
            if (parsed > 0) timestamp = parsed;
        }
        
        for (const vLog of vSess.machines) {
            if (!vLog.machineId) continue;
            allMachineIds.add(vLog.machineId);
            
            const weightNum = Number(vLog.weight) || 0;
            if (weightNum > 0) {
                if (!machineWeightEntries[vLog.machineId]) machineWeightEntries[vLog.machineId] = [];
                machineWeightEntries[vLog.machineId].push({ weight: weightNum, timestamp, sessionIndex });
            }
        }
        sessionIndex++;
      }

      if (allMachineIds.size > 0) {
        const trainer = trainers.find(t => t.id === 'legacy-trainer') || trainers[0];
        
        for (const mId of Array.from(allMachineIds)) {
          const settingId = `${selectedClientId}_${mId}`;
          const settingRef = doc(db, 'clientMachineSettings', settingId);
          
          const extracted = extractedSettings.find(s => s.machineId === mId);
          const finalSettings: Record<string, string> = (extracted && extracted.rawSettings && Object.keys(extracted.rawSettings).length > 0) 
            ? { ...extracted.rawSettings } 
            : {};
          
          if (extracted) {
            if (extracted.seat) finalSettings['Seat'] = extracted.seat;
            if (extracted.gap) finalSettings['Gap'] = extracted.gap;
            if (extracted.backPad) finalSettings['Back Pad'] = extracted.backPad;
            if (extracted.handles) finalSettings['Handles'] = extracted.handles;
            if (extracted.armPad) finalSettings['Arm Pad'] = extracted.armPad;
          }

          const updateData: any = {
            clientId: selectedClientId,
            machineId: mId,
            updatedBy: trainer?.initials || 'OCR',
            updatedAt: serverTimestamp(),
            notes: 'Extracted from legacy chart'
          };

          const cleanedSettings = sanitizeSettingsMap(finalSettings);
          if (Object.keys(cleanedSettings).length > 0) {
            updateData.settings = cleanedSettings;
          }

          const entries = machineWeightEntries[mId] || [];
          if (entries.length > 0) {
            entries.sort((a, b) => {
              if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
              return a.sessionIndex - b.sessionIndex;
            });
            const oldest = entries[0];
            const newest = entries[entries.length - 1];
            updateData.startingWeight = extracted?.startingWeight ? Number(extracted.startingWeight) : oldest.weight;
            updateData.startingWeightDate = new Date(oldest.timestamp).toISOString();
            updateData.currentWeight = extracted?.currentWeight ? Number(extracted.currentWeight) : newest.weight;
          } else {
             if (extracted?.startingWeight) updateData.startingWeight = Number(extracted.startingWeight);
             if (extracted?.currentWeight) updateData.currentWeight = Number(extracted.currentWeight);
          }

          currentBatch.set(settingRef, updateData, { merge: true });
          
          opCount++;
          updateProgress();
          await commitBatchIfNeeded();
        }
      }

      // Final commit for any leftover operations
      await commitBatchIfNeeded(true);
      setFinalizeProgress(100);

      if (onComplete) onComplete();
      toastSuccess(
        skippedEmptyCount > 0
          ? `Imported ${sessionsToImport.length} session(s). Skipped ${skippedEmptyCount} empty column(s) from the chart.`
          : `Imported ${sessionsToImport.length} session(s) successfully.`,
      );
    } catch (err: any) {
      console.error(err);
      toastError(err.message || 'Finalization failed. Check Firestore quotas.');
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6 p-4 sm:p-6 bg-slate-950 min-h-screen text-slate-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-900">
        <div className="flex items-center gap-4">
          {onComplete && (
            <button
              type="button"
              onClick={onComplete}
              className="h-10 w-10 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-all shrink-0 shadow-sm"
              title="Back to Client Profile"
            >
              <ArrowLeft className="w-5 h-5 text-[#F06C22]" />
            </button>
          )}
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tighter uppercase italic text-white flex items-center gap-2">
              OCR Legacy Pipeline
            </h1>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
              Multimodal Chart Recognition Engine v3.1
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="w-60 bg-slate-900 border-slate-800 text-white font-bold h-11">
              <SelectValue placeholder="Select Target Client..." />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-white">
              {clients.map(c => (
                <SelectItem key={c.id} value={c.id!} className="hover:bg-slate-800 focus:bg-slate-800">
                  {c.firstName} {c.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {validationSessions.length > 0 && (
            <Button
              onClick={finalizeImport}
              disabled={isFinalizing || validationSessions.some(s => !s.date)}
              className="bg-[#F06C22] hover:bg-[#F06C22]/90 text-white font-black px-6 h-11 tracking-widest uppercase text-xs disabled:opacity-50"
            >
              {isFinalizing ? 'Committing...' : '[ Finalize & Import Data ]'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Input/Upload */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="bg-[#0A2E46]/30 border-slate-800 overflow-hidden">
            <CardHeader className="bg-slate-900/50 py-3 border-b border-slate-800">
              <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-400">
                Data Source Upload
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="mb-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">Expected Sessions to Extract</label>
                  <div className="flex items-center gap-4 bg-slate-900 border border-slate-700 rounded-xl p-3">
                    <Input 
                      type="number"
                      value={expectedSessions}
                      onChange={(e) => setExpectedSessions(parseInt(e.target.value) || 0)}
                      className="w-24 bg-slate-800 border-slate-700 text-center font-black text-lg focus:ring-[#F06C22] h-10"
                    />
                    <p className="text-[11px] text-slate-400 font-medium leading-tight">
                      Bounding cross-grid search space to maximize extraction speed.
                    </p>
                  </div>
                </div>
              </div>

              <div 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  handleFileSelect({ target: { files: e.dataTransfer.files } } as any);
                }}
                className="w-full h-40 border-2 border-dashed border-slate-700 bg-slate-900/50 rounded-xl flex flex-col items-center justify-center p-6 cursor-pointer hover:border-[#F06C22]/50 hover:bg-slate-800/30 transition-all group relative"
              >
                <input 
                  type="file" 
                  multiple 
                  accept="image/*,application/pdf" 
                  ref={fileInputRef}
                  className="hidden" 
                  onChange={handleFileSelect}
                />
                <Upload className="w-10 h-10 text-slate-600 group-hover:text-[#F06C22] mb-3 transition-colors" />
                <p className="text-sm font-black text-slate-300 uppercase tracking-tighter text-center">Drop Multiple Chart Images</p>
                <p className="text-[11px] font-bold text-slate-500 uppercase mt-2 text-center">Batch Processing (Up to 8 Images)</p>
              </div>

              {files.length > 0 && (
                  <div className="mt-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Queue ({files.length})</p>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={clearFiles}
                        className="text-[11px] font-black text-red-500 hover:text-red-400 hover:bg-red-500/10 h-6 uppercase px-2"
                      >
                        Clear All
                      </Button>
                    </div>
                    
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-800">
                      {files.map((file, idx) => (
                        <div key={idx} className="relative group bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shrink-0 w-24 h-24">
                          {file.previewUrl ? (
                            <img src={file.previewUrl} className="w-full h-full object-cover opacity-60" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-slate-800">
                              <FileText className="w-6 h-6 text-slate-600" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button onClick={() => removeFile(idx)} className="p-1.5 bg-red-600/20 text-red-500 rounded-full hover:bg-red-500 hover:text-white transition-all">
                              <Trash2 size={12} />
                            </button>
                          </div>
                          <div className="absolute bottom-1 left-1 right-1 px-1 py-0.5 bg-black/50 backdrop-blur-sm rounded text-[7px] font-black truncate text-white">
                            {file.name}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="space-y-3 mt-6">
                      <Button 
                        className={cn(
                          "w-full text-white font-black h-14 tracking-widest uppercase text-xs transition-all shadow-xl shadow-[#F06C22]/10",
                          expectedSessions > 0 && selectedClientId ? "bg-[#F06C22] hover:bg-[#D95B16] border-none" : "bg-slate-800 border-slate-700 opacity-50 cursor-not-allowed"
                        )}
                        onClick={runOCR}
                        disabled={isScanning || !selectedClientId || expectedSessions <= 0}
                      >
                        <Maximize className={cn("w-4 h-4 mr-2", isScanning && "animate-spin")} />
                        {isScanning ? 'SCANNING GRID...' : 'FULL CLINICAL EXTRACTION'}
                      </Button>

                      <div className="relative py-2 flex items-center">
                        <div className="grow border-t border-slate-800"></div>
                        <span className="shrink mx-4 text-[11px] font-black uppercase text-slate-600 tracking-widest">OR</span>
                        <div className="grow border-t border-slate-800"></div>
                      </div>

                      <Button 
                        variant="ghost"
                        className="w-full border border-slate-800 text-slate-400 font-bold h-12 tracking-widest uppercase text-[11px] hover:bg-slate-800 hover:text-white transition-all shadow-inner"
                        onClick={runSettingsOCR}
                        disabled={isScanningSettings || !selectedClientId || files.length === 0}
                      >
                        <Plus className={cn("w-3 h-3 mr-2", isScanningSettings && "animate-spin")} />
                        {isScanningSettings ? 'EXTRACTING...' : 'Import Machine Settings Only'}
                      </Button>
                      <p className="text-[7px] font-bold text-slate-600 uppercase text-center tracking-tighter">Use this to only import seat/pad setup without sessions</p>
                    </div>
                  </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Validation HUD */}
      <div className="lg:col-span-8 flex flex-col">
        <Card className="bg-[#0A2E46] border-slate-800 flex-1 flex flex-col min-h-150 shadow-2xl">
          <CardHeader className="py-4 border-b border-slate-800 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-black uppercase tracking-widest text-[#F06C22]">
                Validation HUD
              </CardTitle>
              <CardDescription className="text-[11px] font-bold text-slate-400">
                Verify extracted patterns before database commit
              </CardDescription>
            </div>
            {(validationSessions.length > 0 || extractedSettings.length > 0) && (
              <div className="flex gap-4 items-center">
                <div className="text-right px-4 border-r border-slate-800">
                  <p className="text-[11px] font-black text-white uppercase">{validationSessions.length > 0 ? `Sessions: ${validationSessions.length}` : 'Settings Mode'}</p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-tighter">Extraction Results</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-black text-[#F06C22] uppercase">Settings: {extractedSettings.length}</p>
                  <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-tighter">Verified Alignment</p>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0 overflow-hidden flex-1 relative">
            <AnimatePresence mode="wait">
              {validationSessions.length === 0 && extractedSettings.length === 0 ? (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex flex-col items-center justify-center p-12 text-center"
                >
                  {(isScanning || isScanningSettings) ? (
                    <div className="flex flex-col items-center space-y-6">
                      <div className="relative">
                        <div className="w-24 h-24 rounded-full border-4 border-[#0A2E46] border-t-[#F06C22] animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Maximize className="w-10 h-10 text-[#F06C22]" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-lg font-black text-white uppercase tracking-widest animate-pulse">
                          {isScanning ? 'Analyzing Grid Intersections' : 'Decoding Machine Pad Configs'}
                        </h3>
                        <div className="w-64 h-2 bg-white/5 border border-white/5 rounded-full overflow-hidden mx-auto mt-4 mb-2">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${scanPercentage}%` }}
                            className="h-full bg-linear-to-r from-[#F06C22] to-[#FF8C42] shadow-[0_0_15px_rgba(240,108,34,0.3)]"
                          />
                        </div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest max-w-xs mx-auto">
                          {isScanning ? 'Performing row-by-row clinical extraction. This may take 30-60 seconds.' : 'Extracting Seat, Gap, and Pad settings from Column 2.'}
                        </p>
                      </div>
                      <Badge variant="outline" className="bg-[#0A2E46] text-[#F06C22] border-[#F06C22]/30 px-4 py-1">
                        {scanProgress}
                      </Badge>
                    </div>
                  ) : (
                    <>
                      <div className="w-20 h-20 bg-slate-900/50 rounded-full flex items-center justify-center mb-6">
                        <History className="w-10 h-10 text-slate-700" />
                      </div>
                      <h3 className="text-lg font-black text-slate-500 uppercase tracking-widest mb-2 italic">Idle - Waiting for Feed</h3>
                      <p className="text-xs text-slate-600 max-w-xs leading-relaxed">
                        Enter target session count and upload high-resolution scans to initiate the multimodal clinical extraction pipeline.
                      </p>
                    </>
                  )}
                </motion.div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-4 space-y-6 overflow-y-auto max-h-[75dvh] scrollbar-thin scrollbar-thumb-slate-700"
                >
                  {/* Macro Summary Panel */}
                  <div className="bg-[#0A2E46] border border-[#F06C22]/30 rounded-xl p-4 mb-4 flex items-center justify-between shadow-[0_0_20px_rgba(240,108,34,0.05)]">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-[#F06C22]/10 rounded-full text-[#F06C22]">
                        <CheckCircle2 size={24} />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">
                          {validationSessions.length > 0 ? 'Clinical History Consolidated' : 'Machine Settings Extracted'}
                        </h3>
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">
                          {validationSessions.length > 0 
                            ? `Successfully extracted ${Array.from(new Set(validationSessions.flatMap(s => s.machines.map(m => m.name)))).length} unique machines spanning ${validationSessions.length} total sessions.`
                            : `Successfully extracted configurations for ${extractedSettings.length} unique machines.`
                          }
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-[#F06C22] text-[#F06C22] font-black uppercase text-[11px] px-3">
                      CONTINUITY VERIFIED
                    </Badge>
                  </div>

                    {/* Extraction Frequency Panel */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 mb-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em]">Historical Machine Settings</h3>
                        {extractedSettings.length > 0 && (
                          <Badge className="bg-[#F06C22] text-white text-[11px] font-black">
                            {extractedSettings.length} MACHINES FOUND
                          </Badge>
                        )}
                      </div>
                      
                      {extractedSettings.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                          {extractedSettings.map((s, idx) => (
                            <div key={idx} className="bg-slate-800/50 border border-slate-700 rounded-lg p-2 flex flex-col gap-1">
                              <p className="text-[11px] font-black text-[#F06C22] truncate uppercase">{s.machineId.replace(/_/g, ' ')}</p>
                              <div className="flex flex-wrap gap-1">
                                {s.seat && <span className="text-[7px] bg-slate-900 px-1 rounded text-slate-400">S:{s.seat}</span>}
                                {s.gap && <span className="text-[7px] bg-slate-900 px-1 rounded text-slate-400">G:{s.gap}</span>}
                                {s.backPad && <span className="text-[7px] bg-slate-900 px-1 rounded text-slate-400">B:{s.backPad}</span>}
                                {s.handles && <span className="text-[7px] bg-slate-900 px-1 rounded text-slate-400">H:{s.handles}</span>}
                              </div>
                              <div className="flex gap-2 mt-2">
                                <div className="flex flex-col gap-0.5 w-full">
                                  <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest leading-none">STR LBS</span>
                                  <input type="number" 
                                      value={s.startingWeight || ""} 
                                      onChange={(e) => {
                                        const newSet = [...extractedSettings];
                                        newSet[idx].startingWeight = e.target.value;
                                        setExtractedSettings(newSet);
                                      }}
                                      className="w-full h-6 bg-slate-900 focus-visible:bg-slate-800 border focus-visible:border-[#F06C22] border-slate-700 rounded text-[11px] text-white px-1 text-center font-bold tabular-nums outline-none transition-colors"
                                      placeholder="--"
                                  />
                                </div>
                                <div className="flex flex-col gap-0.5 w-full">
                                  <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest leading-none">CUR LBS</span>
                                  <input type="number" 
                                      value={s.currentWeight || ""} 
                                      onChange={(e) => {
                                        const newSet = [...extractedSettings];
                                        newSet[idx].currentWeight = e.target.value;
                                        setExtractedSettings(newSet);
                                      }}
                                      className="w-full h-6 bg-slate-900 focus-visible:bg-slate-800 border focus-visible:border-[#F06C22] border-slate-700 rounded text-[11px] text-white px-1 text-center font-bold tabular-nums outline-none transition-colors"
                                      placeholder="--"
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-600 italic">No global settings extracted yet. Use the "Extract Machine Settings Only" button.</p>
                      )}
                    </div>

                    {/* Extraction Frequency Panel */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 mb-4">
                      <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] mb-3">Machine Extraction Frequency</h3>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(
                          validationSessions.reduce((acc, sess) => {
                            sess.machines.forEach(m => {
                              acc[m.name] = (acc[m.name] || 0) + 1;
                            });
                            return acc;
                          }, {} as Record<string, number>)
                        ).map(([name, count]) => (
                          <Badge key={name} variant="secondary" className="bg-slate-800 text-slate-300 text-[11px] font-bold px-2 py-1 rounded-md border border-slate-700">
                            {name}: {count} logs
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="overflow-x-auto pb-6">
                      <table className="border-collapse table-fixed min-w-max w-full">
                        <thead>
                          <tr>
                            <th className="sticky left-0 z-20 bg-[#0A2E46] border-r border-b border-slate-700 w-50 p-2 text-left">
                              <span className="text-[11px] font-black italic uppercase text-[#F06C22]">Machine / Session</span>
                            </th>
                            {validationSessions.map(session => (
                              <th key={session.id} className={cn(
                                "w-30 p-2 bg-slate-900 border-r border-b border-slate-800 text-center relative group",
                                session.isInferredDate && "border-amber-500/50 shadow-[inset_0_0_10px_rgba(245,158,11,0.1)]"
                              )}>
                                <button
                                  onClick={() => setValidationSessions(prev => prev.filter(s => s.id !== session.id))}
                                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-0.5 bg-red-500/20 hover:bg-red-500 text-red-500 hover:text-white rounded-sm transition-all z-10"
                                  title="Remove extracted session completely"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                                <div className="flex flex-col items-center">
                                  <Badge className={cn("text-[11px] font-black h-4 px-1 rounded-sm mb-1", session.isInferredDate ? "bg-amber-600 border-none text-white" : "bg-slate-800 border-slate-700 text-white")}>
                                    S#{session.sessionNumber}
                                  </Badge>
                                  <input 
                                    type="date"
                                    className={cn("bg-slate-900 border focus:bg-slate-800 focus:border-[#F06C22] w-22.5 text-[11px] uppercase font-bold text-center outline-none transition-all rounded p-1", session.isInferredDate ? "border-amber-500/50 text-amber-400" : "border-slate-700 text-white")}
                                    value={session.date}
                                    onChange={e => setValidationSessions(prev => prev.map(s => s.id === session.id ? { ...s, date: e.target.value, isInferredDate: false } : s))}
                                  />
                                  <input 
                                    className="bg-transparent border-b border-transparent focus:border-[#F06C22] w-10 text-[11px] text-slate-400 text-center outline-none transition-all mt-0.5 uppercase"
                                    value={session.trainer}
                                    placeholder="INI"
                                    onChange={e => setValidationSessions(prev => prev.map(s => s.id === session.id ? { ...s, trainer: e.target.value } : s))}
                                  />
                                  {session.isInferredDate && (
                                    <div className="absolute -top-3 right-1/2 translate-x-1/2 whitespace-nowrap bg-amber-500 text-slate-950 font-black text-[7px] px-1 py-0.5 rounded uppercase flex items-center shadow-lg pointer-events-none">
                                      <AlertTriangle size={8} className="mr-0.5" /> ⚠️ Date Inferred
                                    </div>
                                  )}
                                  {session.hasConflict && (
                                    <div className="absolute -top-8 right-1/2 translate-x-1/2 whitespace-nowrap bg-red-600 text-white font-black text-[7px] px-1 py-0.5 rounded uppercase flex items-center shadow-lg pointer-events-none z-50">
                                      🚨 Merge Conflict: Check Machine Weights
                                    </div>
                                  )}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {Array.from(new Set(validationSessions.flatMap(s => s.machines.map(m => m.name)))).map(machineName => (
                            <tr key={machineName} className="group hover:bg-slate-800/30 transition-colors">
                              <th className="sticky left-0 z-10 bg-[#0A2E46] border-r border-slate-700 p-2 text-left align-middle group-hover:bg-slate-800/80 shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
                                <div className="flex flex-col justify-center">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <div className="w-4 h-4 rounded-md bg-slate-800 flex items-center justify-center shrink-0 shadow-sm shadow-zinc-200">
                                      <Dumbbell className="w-2.5 h-2.5 text-white" />
                                    </div>
                                    <span className="text-[11px] font-black uppercase text-white truncate max-w-37.5">{machineName}</span>
                                  </div>
                                </div>
                              </th>
                              {validationSessions.map(session => {
                                const log = session.machines.find(m => m.name === machineName);
                                return (
                                  <td key={session.id} className="border-r border-slate-700/50 p-2 align-middle hover:bg-slate-700/50 transition-colors h-16">
                                    {log ? (
                                      <div className="flex flex-col items-center gap-1 group/cell">
                                        <div className="flex items-baseline justify-center gap-1">
                                          <input 
                                            className="bg-transparent text-white font-black w-10 text-center border-b border-transparent focus:bg-slate-800 focus:border-[#F06C22] hover:border-slate-700/50 focus:outline-none text-sm transition-all rounded-t-sm"
                                            value={log.weight}
                                            onChange={e => updateLogData(session.id, log.id, 'weight', parseInt(e.target.value) || 0)}
                                            placeholder="LBS"
                                            title="Weight (lbs)"
                                          />
                                          <span className="text-slate-600 text-[11px] font-black">X</span>
                                          <input 
                                            className={cn("bg-transparent font-black w-10 text-center border-b border-transparent focus:bg-slate-800 focus:border-[#F06C22] hover:border-slate-700/50 focus:outline-none text-sm transition-all rounded-t-sm", log.isStaticHold ? "text-blue-400" : "text-white")}
                                            value={log.isStaticHold ? (log.timeUnderLoad ?? 0) : (log.reps ?? 0)}
                                            onChange={e => updateLogData(session.id, log.id, log.isStaticHold ? 'timeUnderLoad' : 'reps', parseInt(e.target.value) || 0)}
                                            placeholder={log.isStaticHold ? "SEC" : "REP"}
                                            title={log.isStaticHold ? "Seconds" : "Reps"}
                                          />
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                          <label className="flex items-center gap-1 cursor-pointer" title="Static Hold (TSC)">
                                            <input 
                                              type="checkbox" 
                                              checked={log.isStaticHold} 
                                              onChange={e => updateLogData(session.id, log.id, 'isStaticHold', e.target.checked)}
                                              className="w-2.5 h-2.5 bg-slate-900 border-slate-700 rounded text-[#F06C22] focus:ring-[#F06C22] focus:ring-offset-0"
                                            />
                                            <span className={cn("text-[7px] font-black uppercase tracking-tighter", log.isStaticHold ? "text-blue-400" : "text-slate-600")}>
                                              TSC
                                            </span>
                                          </label>
                                          
                                          <button 
                                            onClick={() => {
                                              setValidationSessions(prev => prev.map(s => {
                                                if (s.id !== session.id) return s;
                                                return { ...s, machines: s.machines.filter(l => l.id !== log.id) };
                                              }))
                                            }}
                                            className="text-slate-600 hover:text-red-500 opacity-0 group-hover/cell:opacity-100 transition-all p-0.5 hover:bg-slate-800 rounded"
                                            title="Delete Log"
                                          >
                                            <Trash2 size={10} />
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-center opacity-10">
                                        <div className="w-1 h-1 rounded-full bg-slate-600" />
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {validationSessions.length > 0 && (
                        <div className="mt-8 mb-4">
                          <Button 
                            onClick={finalizeImport}
                            disabled={isFinalizing || validationSessions.some(s => !s.date)}
                            className="w-full flex items-center justify-center gap-3 bg-[#F06C22] hover:bg-[#D95B16] text-white font-black text-lg h-20 tracking-widest uppercase transition-all shadow-[0_10px_40px_rgba(240,108,34,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isFinalizing ? (
                              <div className="flex flex-col items-center gap-3 w-full max-w-md px-6">
                                <div className="flex justify-between w-full mb-1">
                                  <span className="text-[11px] font-black text-white/60 uppercase tracking-widest">Database Sync Integrity</span>
                                  <span className="text-[11px] font-black text-white uppercase">{finalizeProgress}%</span>
                                </div>
                                <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden border border-white/5">
                                  <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${finalizeProgress}%` }}
                                    className="h-full bg-linear-to-r from-[#F06C22] to-[#FF8C42] shadow-[0_0_10px_rgba(240,108,34,0.5)]"
                                  />
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                  <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin"></div>
                                  <p className="text-[11px] font-bold text-white uppercase tracking-tighter">Committing Clinical Records...</p>
                                </div>
                              </div>
                            ) : (
                              <>
                                <ArrowRight className="w-8 h-8" />
                                [ Confirm & Write Full History ]
                              </>
                            )}
                          </Button>
                        </div>
                      )}

                      {validationSessions.length === 0 && extractedSettings.length > 0 && (
                        <div className="mt-8 mb-4">
                          <Button 
                            onClick={finalizeImport}
                            disabled={isFinalizing}
                            className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-lg h-20 tracking-widest uppercase transition-all shadow-[0_10px_40px_rgba(16,185,129,0.2)]"
                          >
                            {isFinalizing ? 'Saving Settings...' : '[ Save Machine Settings Only ]'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
