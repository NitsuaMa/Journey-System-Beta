import React, { useState } from "react";
import { hashPin } from "../lib/auth-utils";
import { generateSearchTokens } from "@/lib/utils";
import { CreateTrainerPayload } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveStudio } from "../ActiveStudioContext";
import { useToast } from "../contexts/ToastContext";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (trainerData: CreateTrainerPayload) => void | Promise<void>;
}

export function CreateTrainerModal({ isOpen, onOpenChange, onSubmit }: Props) {
  const { error: toastError } = useToast();
  const { availableStudios, activeStudioId } = useActiveStudio();
  const [fullName, setFullName] = useState("");
  const [initials, setInitials] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [primaryHomeStudioId, setPrimaryHomeStudioId] = useState("");

  React.useEffect(() => {
    if (isOpen && activeStudioId) {
      setPrimaryHomeStudioId(activeStudioId);
    }
  }, [isOpen, activeStudioId]);

  const [mindbodyStaffId, setMindbodyStaffId] = useState("");
  const [fetchingStaff, setFetchingStaff] = useState(false);
  const [staffOptions, setStaffOptions] = useState<
    { id: string; fullName: string; email: string; imageUrl?: string | null }[]
  >([]);

  const handleFetchStaff = async () => {
    const homeStudio = availableStudios.find(
      (s) => s.id === primaryHomeStudioId,
    );
    const siteId = homeStudio?.mindbodySiteId
      ? String(homeStudio.mindbodySiteId).trim()
      : null;

    if (!siteId) {
      console.warn(
        "[CreateTrainerModal] No Mindbody Site ID configured for selected studio:",
        primaryHomeStudioId,
      );
      setStaffOptions([]);
      return;
    }

    setFetchingStaff(true);
    try {
      const res = await fetch("/api/mindbody/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });

      if (!res.ok) {
        throw new Error(`API returned status ${res.status}`);
      }

      const data = await res.json();
      setStaffOptions(data.staff || []);
    } catch (err: any) {
      console.error("Staff fetch error:", err);
    } finally {
      setFetchingStaff(false);
    }
  };

  // Auto-fetch Mindbody staff list when modal opens or studio changes
  React.useEffect(() => {
    if (isOpen) {
      handleFetchStaff();
    }
  }, [isOpen, primaryHomeStudioId]);

  const handleSubmit = async () => {
    if (!fullName || !initials || !primaryHomeStudioId) return;

    const searchTokens = generateSearchTokens(fullName);

    const payload: CreateTrainerPayload = {
      fullName: fullName.trim(),
      initials: initials.trim(),
      requiresPinReset: true,
      isOwner,
      isVisibleOnCalendar: true,
      searchTokens,
      primaryHomeStudioId,
      accessibleStudioIds: [primaryHomeStudioId],
      systemStatus: "active",
      mindbodyStaffId: mindbodyStaffId.trim() || "",
      // Whatever the bulk staff call already returned. No extra API call, and
      // the trainer has an avatar from their first sign-in.
      photoUrl:
        staffOptions.find((s) => s.id === mindbodyStaffId.trim())?.imageUrl || null,
      order: Date.now(),
    } as any;

    // Strict validation
    if (!payload.fullName) {
      toastError("Validation Error: Full Name is required.");
      return;
    }
    if (!payload.initials || payload.initials.length < 2) {
      toastError("Validation Error: Initials must be at least 2 characters.");
      return;
    }
    if (!payload.primaryHomeStudioId) {
      toastError("Validation Error: Primary Home Studio ID is required.");
      return;
    }
    if (
      !payload.accessibleStudioIds ||
      payload.accessibleStudioIds.length === 0
    ) {
      toastError("Validation Error: Accessible Studio ID details must be set.");
      return;
    }

    await onSubmit(payload);

    setFullName("");
    setInitials("");
    setIsOwner(false);
    setMindbodyStaffId("");
    setPrimaryHomeStudioId(activeStudioId || "");
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-106.25 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 shadow-2xl rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black italic uppercase text-slate-900 dark:text-white tracking-widest">
            Add New Trainer
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">
              Full Name
            </Label>
            <Input
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                const parts = e.target.value.split(" ");
                if (parts.length > 1) {
                  setInitials(
                    (parts[0][0] + parts[parts.length - 1][0]).toUpperCase(),
                  );
                } else if (parts[0]) {
                  setInitials(parts[0].substring(0, 2).toUpperCase());
                } else {
                  setInitials("");
                }
              }}
              className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-12"
              placeholder="e.g. John Doe"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">
              Initials
            </Label>
            <Input
              value={initials}
              onChange={(e) => setInitials(e.target.value.toUpperCase())}
              className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-12 uppercase"
              placeholder="JD"
              maxLength={3}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">
              Primary Home Studio <span className="text-rose-500">*</span>
            </Label>
            <Select
              value={primaryHomeStudioId}
              onValueChange={setPrimaryHomeStudioId}
            >
              <SelectTrigger className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-12 text-sm font-bold focus:ring-[#38BDF8]">
                <SelectValue placeholder="Select primary home studio...">
                  {availableStudios.find(
                    (s) =>
                      s.id === primaryHomeStudioId ||
                      s.name?.toLowerCase() ===
                        primaryHomeStudioId?.toLowerCase(),
                  )?.name || primaryHomeStudioId}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-h-75">
                {availableStudios.map((studio) => (
                  <SelectItem
                    key={studio.id}
                    value={studio.id || ""}
                    className="focus:bg-[#38BDF8] focus:text-slate-950 cursor-pointer"
                  >
                    {studio.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">
                Mindbody Staff ID
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleFetchStaff}
                disabled={fetchingStaff}
                className="h-7 text-[10px] font-black uppercase text-indigo-500 hover:text-indigo-600 px-2"
              >
                {fetchingStaff ? "Fetching..." : "Lookup from Mindbody"}
              </Button>
            </div>
            {staffOptions.length > 0 ? (
              <Select
                value={mindbodyStaffId}
                onValueChange={(val) => {
                  setMindbodyStaffId(val);
                  const selected = staffOptions.find((s) => s.id === val);
                  if (selected && !fullName) {
                    setFullName(selected.fullName);
                    const parts = selected.fullName.split(" ");
                    if (parts.length > 1) {
                      setInitials(
                        (
                          parts[0][0] + parts[parts.length - 1][0]
                        ).toUpperCase(),
                      );
                    }
                  }
                }}
              >
                <SelectTrigger className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-12 text-sm font-bold w-full">
                  <SelectValue
                    placeholder={
                      fetchingStaff
                        ? "Loading Mindbody Staff..."
                        : "Select Mindbody Staff..."
                    }
                  >
                    {staffOptions.find((s) => s.id === mindbodyStaffId)
                      ?.fullName ||
                      (mindbodyStaffId ? `ID: ${mindbodyStaffId}` : undefined)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  sideOffset={4}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white max-h-72 w-(--radix-select-trigger-width) min-w-85 font-bold shadow-2xl z-50 rounded-2xl p-1"
                >
                  {staffOptions.map((s) => (
                    <SelectItem
                      key={s.id}
                      value={s.id}
                      className="font-bold py-2.5 px-3 focus:bg-slate-100 dark:focus:bg-slate-800 rounded-xl cursor-pointer"
                    >
                      <div className="flex items-center justify-between w-full gap-3 text-xs sm:text-sm">
                        <span className="flex items-center gap-2.5 min-w-0">
                          <span className="relative w-7 h-7 rounded-lg overflow-hidden shrink-0 grid place-items-center bg-slate-100 dark:bg-slate-800 text-[10px] font-black text-slate-500">
                            {s.fullName?.[0] || "?"}
                            {s.imageUrl && (
                              <img
                                src={s.imageUrl}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover"
                              />
                            )}
                          </span>
                          <span className="font-extrabold text-slate-900 dark:text-white truncate">
                            {s.fullName}
                          </span>
                        </span>
                        <span className="font-mono text-xs text-[#F06C22] font-bold shrink-0 bg-[#F06C22]/10 px-2 py-0.5 rounded-md border border-[#F06C22]/20">
                          ID: {s.id}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={mindbodyStaffId}
                onChange={(e) =>
                  setMindbodyStaffId(e.target.value.replace(/[^0-9]/g, ""))
                }
                className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-12 font-mono text-sm"
                placeholder="e.g. 100000123"
              />
            )}
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="space-y-0.5">
              <Label className="text-sm font-bold text-slate-900 dark:text-white">
                System Admin
              </Label>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold uppercase">
                Grant full hub access
              </p>
            </div>
            <Switch checked={isOwner} onCheckedChange={setIsOwner} />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!fullName || !initials || !primaryHomeStudioId}
            className="w-full bg-[#F06C22] hover:bg-[#d95b16] text-white font-black uppercase text-xs h-12 rounded-xl transition-all shadow-[0_0_20px_rgba(240,108,34,0.3)]"
          >
            Create Trainer Profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
