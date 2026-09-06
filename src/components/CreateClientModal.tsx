import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  UserPlus,
  Loader2,
  CheckCircle2,
  FileUp,
  AlertTriangle,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { Client, Studio } from "../types";
import { handleFirestoreError, OperationType } from "../lib/firestore-errors";
import { cn } from "@/lib/utils";

// Reusing Select component since it's already implemented in other files or can be imported.
// If it's not imported here, we'll do native select.
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CreateClientModalProps {
  clients: Client[];
  initialName?: string;
  onClose: () => void;
  onClientCreated: (clientId: string, routeToImporter?: boolean) => void;
  studios: Studio[];
}

export function CreateClientModal({
  clients,
  initialName = "",
  onClose,
  onClientCreated,
  studios,
}: CreateClientModalProps) {
  const nameParts = initialName.trim().split(" ");
  const [firstName, setFirstName] = useState(nameParts[0] || "");
  const [lastName, setLastName] = useState(
    nameParts.length > 1 ? nameParts.slice(1).join(" ") : "",
  );
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState<string>("");
  const [age, setAge] = useState<string>("");
  const [homeStudioId, setHomeStudioId] = useState<string>("");
  const [discoveryNotes, setDiscoveryNotes] = useState("");

  const [activeTab, setActiveTab] = useState<"prospect" | "existing">(
    "prospect",
  );
  const [routeToImporter, setRouteToImporter] = useState(true);

  // Submission & Validation States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<Client | null>(null);

  const executeSave = async (force: boolean = false) => {
    if (!firstName || !lastName) return;

    if (!force) {
      const exactMatch = clients.find(
        (c) =>
          c.firstName.toLowerCase() === firstName.toLowerCase() &&
          c.lastName.toLowerCase() === lastName.toLowerCase(),
      );
      if (exactMatch) {
        setDuplicateWarning(exactMatch);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const clientData: any = {
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        discoveryNotes: discoveryNotes || null, // Stage 1 Notes
        isActive: true,
        completedSessions: 0,
        sessionCount: 0,
        remainingSessions: activeTab === "prospect" ? 1 : 10,
        gender: gender || null,
        age: age ? parseInt(age, 10) : null,
        height: "5'10\"", // Default, to be updated in Stage 2
        homeStudioId: homeStudioId || null,
        consultationCompleted: activeTab === "existing",
        requiresConsultation: activeTab === "prospect",
      };

      // Clean up properties that are undefined if any stuck around
      Object.keys(clientData).forEach((key) => {
        if (clientData[key] === undefined) {
          clientData[key] = null;
        }
      });

      const docRef = await addDoc(collection(db, "clients"), {
        ...clientData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      onClientCreated(docRef.id, activeTab === "existing" && routeToImporter);
      onClose();
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, "clients");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveClick = () => executeSave(false);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 dark:bg-slate-950/90 backdrop-blur-sm">
      <Card className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl dark:shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col max-h-[95dvh] rounded-[32px] overflow-hidden relative text-slate-900 dark:text-white">
        {duplicateWarning && (
          <div className="absolute inset-0 z-50 bg-slate-950/40 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-white dark:bg-slate-900 border border-amber-500 rounded-[24px] p-8 max-w-md w-full shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-2 bg-amber-500"></div>
              <div className="flex flex-col items-center text-center gap-6">
                <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-2">
                    Duplicate Found
                  </h3>
                  <p className="text-slate-500 dark:text-slate-400 font-medium text-sm leading-relaxed">
                    A client named{" "}
                    <span className="text-slate-900 dark:text-white font-bold">
                      {duplicateWarning.firstName} {duplicateWarning.lastName}
                    </span>{" "}
                    already exists. Are you sure you want to create a duplicate
                    profile?
                  </p>
                </div>
                <div className="flex gap-4 w-full mt-4">
                  <Button
                    variant="outline"
                    className="flex-1 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => {
                      if (duplicateWarning.id) {
                        onClientCreated(duplicateWarning.id, false);
                      }
                      onClose();
                    }}
                  >
                    Cancel & View Existing
                  </Button>
                  <Button
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-foreground font-black uppercase tracking-wider"
                    onClick={() => executeSave(true)}
                  >
                    Force Create
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="p-8 pb-4 shrink-0 border-b border-slate-200 dark:border-slate-800">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700/50 w-full shadow-md dark:shadow-2xl">
            <button
              onClick={() => setActiveTab("prospect")}
              className={cn(
                "flex-1 py-4 text-sm md:text-base font-black uppercase tracking-widest rounded-xl transition-all duration-300 cursor-pointer",
                activeTab === "prospect"
                  ? "bg-[#F06C22] text-white shadow-[0_0_20px_rgba(240,108,34,0.3)]"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-white",
              )}
            >
              New Prospect
            </button>
            <button
              onClick={() => setActiveTab("existing")}
              className={cn(
                "flex-1 py-4 text-sm md:text-base font-black uppercase tracking-widest rounded-xl transition-all duration-300 cursor-pointer",
                activeTab === "existing"
                  ? "bg-[#F06C22] text-white shadow-[0_0_20px_rgba(240,108,34,0.3)]"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-white",
              )}
            >
              Existing Client
            </button>
          </div>
        </div>

        <CardContent className="flex-1 p-8 space-y-8 overflow-y-auto custom-scrollbar bg-white dark:bg-slate-900">
          {/* Stage 1: Identity & Contact */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-[#F06C22] border-b border-slate-200 dark:border-slate-800 pb-2">
              Step 1: Contact Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-500 ml-1">
                  First Name
                </Label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="h-12 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-[#F06C22] rounded-xl font-bold"
                  placeholder="First"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-500 ml-1">
                  Last Name
                </Label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="h-12 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-[#F06C22] rounded-xl font-bold"
                  placeholder="Last"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-500 ml-1">
                  Phone
                </Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-12 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-[#F06C22] rounded-xl font-bold"
                  placeholder="555-555-5555"
                  type="tel"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-500 ml-1">
                  Email (Optional)
                </Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-[#F06C22] rounded-xl font-bold"
                  placeholder="name@email.com"
                  type="email"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-500 ml-1">
                  Gender (Optional)
                </Label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full h-12 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:border-[#F06C22] focus:ring-0 rounded-xl font-bold px-3"
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-500 ml-1">
                  Age (Optional)
                </Label>
                <Input
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="h-12 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-[#F06C22] rounded-xl font-bold"
                  placeholder="e.g. 40"
                  type="number"
                  min="0"
                  max="120"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-500 ml-1">
                  Home Studio (Optional)
                </Label>
                <select
                  value={homeStudioId}
                  onChange={(e) => setHomeStudioId(e.target.value)}
                  className="w-full h-12 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:border-[#F06C22] focus:ring-0 rounded-xl font-bold px-3"
                >
                  <option value="">Select Studio</option>
                  {studios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Discovery Notes */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-[#F06C22] border-b border-slate-200 dark:border-slate-800 pb-2">
              Discovery Notes
            </h3>
            <div className="space-y-2 mt-4">
              <Label className="text-[11px] font-black uppercase tracking-widest text-slate-500 ml-1">
                Initial Context & Questions
              </Label>
              <Textarea
                value={discoveryNotes}
                onChange={(e) => setDiscoveryNotes(e.target.value)}
                placeholder="Why are they coming in? What are their initial questions or concerns? Jot down quick notes to reference during the Stage 2 consultation..."
                className="min-h-30 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-medium placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-[#F06C22] resize-none"
              />
            </div>
          </div>

          {/* Migration Tools (Existing Only) */}
          {activeTab === "existing" && (
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-[#F06C22] border-b border-slate-200 dark:border-slate-800 pb-2">
                Migration Protocol
              </h3>
              <div
                className={cn(
                  "flex items-center gap-4 p-5 rounded-[24px] border transition-all cursor-pointer",
                  routeToImporter
                    ? "bg-slate-50 dark:bg-slate-800 border-[#F06C22]/50 shadow-[0_0_20px_rgba(240,108,34,0.1)]"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-850 hover:border-slate-300 dark:hover:border-slate-750",
                )}
                onClick={() => setRouteToImporter(!routeToImporter)}
              >
                <div
                  className={cn(
                    "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all shrink-0",
                    routeToImporter
                      ? "bg-[#F06C22] border-[#F06C22]"
                      : "border-slate-400 dark:border-slate-600",
                  )}
                >
                  {routeToImporter && (
                    <CheckCircle2 className="w-4 h-4 text-foreground" />
                  )}
                </div>
                <div className="flex flex-col">
                  <p
                    className={cn(
                      "text-[15px] font-black uppercase tracking-tight",
                      routeToImporter
                        ? "text-[#F06C22]"
                        : "text-slate-700 dark:text-slate-300",
                    )}
                  >
                    Route to Legacy Chart Importer
                  </p>
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                    Send immediately to historical data ingestion after
                    creation.
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>

        <div className="p-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shrink-0 z-50 mt-auto">
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-full sm:flex-1 h-14 rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all border border-slate-200 dark:border-slate-800 cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSaveClick}
            disabled={isSubmitting || !firstName || !lastName}
            className="w-full sm:flex-2 h-14 rounded-2xl font-black uppercase tracking-[0.2em] text-[11px] shadow-2xl transition-all active:scale-95 bg-[#F06C22] hover:bg-[#F06C22]/90 text-white cursor-pointer"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <span className="flex items-center justify-center gap-2">
                {activeTab === "prospect" ? (
                  <UserPlus className="w-4 h-4" />
                ) : (
                  <FileUp className="w-4 h-4" />
                )}
                {activeTab === "prospect"
                  ? "Create Contact & Proceed to Stage 2"
                  : "Initialize Migration Profile"}
              </span>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
