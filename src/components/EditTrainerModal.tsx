import React, { useState, useEffect } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { hashPin } from "../lib/auth-utils";
import { generateSearchTokens } from "@/lib/utils";
import { Trainer, Studio, UserRole } from "../types";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Key,
  Users2,
  Shield,
  Eye,
  Calendar,
  Mail,
  UserIcon,
} from "lucide-react";
import { useToast } from "../contexts/ToastContext";

interface Props {
  trainer: Trainer | null;
  authTrainer?: Trainer | null;
  studios: Studio[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updatedData: Partial<Trainer>) => Promise<void> | void;
  isAdminMode?: boolean;
}

export function EditTrainerModal({
  trainer,
  authTrainer,
  studios,
  isOpen,
  onOpenChange,
  onSave,
  isAdminMode,
}: Props) {
  const [fullName, setFullName] = useState("");
  const [nickname, setNickname] = useState("");
  const [initials, setInitials] = useState("");
  const [email, setEmail] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [mindbodyLinked, setMindbodyLinked] = useState(false);

  const [role, setRole] = useState<UserRole>("LifeTransformer");
  const [requiresPinReset, setRequiresPinReset] = useState(false);
  const [primaryHomeStudioId, setPrimaryHomeStudioId] = useState("");
  const [accessibleStudioIds, setAccessibleStudioIds] = useState<string[]>([]);
  const [activeGuestStudioIds, setActiveGuestStudioIds] = useState<string[]>(
    [],
  );
  const [isVisibleOnCalendar, setIsVisibleOnCalendar] = useState(true);
  const [mindbodyStaffId, setMindbodyStaffId] = useState("");

  const [saving, setSaving] = useState(false);
  const [fetchingStaff, setFetchingStaff] = useState(false);
  const [staffOptions, setStaffOptions] = useState<
    { id: string; fullName: string }[]
  >([]);

  const handleFetchStaff = async () => {
    const targetStudioId = primaryHomeStudioId || studios[0]?.id;
    const studio = studios.find((s) => s.id === targetStudioId);
    const siteId = studio?.mindbodySiteId
      ? String(studio.mindbodySiteId).trim()
      : null;

    if (!siteId) {
      console.warn(
        "[EditTrainerModal] No Mindbody Site ID configured for studio:",
        targetStudioId,
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch staff");

      if (data.staff && Array.isArray(data.staff)) {
        setStaffOptions(data.staff);
      }
    } catch (err: any) {
      console.error("Fetch staff error:", err);
    } finally {
      setFetchingStaff(false);
    }
  };

  // Load current values of the trainer being edited
  useEffect(() => {
    if (trainer && isOpen) {
      setFullName(trainer.fullName || "");
      setNickname(trainer.nickname || "");
      setInitials(trainer.initials || "");
      setEmail(trainer.email || "");
      setBrandColor(trainer.brandColor || "#F06C22");
      setMindbodyLinked(trainer.mindbodyLinked || false);

      setRole(trainer.role || "LifeTransformer");
      setRequiresPinReset(trainer.requiresPinReset || false);
      setPrimaryHomeStudioId(trainer.primaryHomeStudioId || "");
      setAccessibleStudioIds(trainer.accessibleStudioIds || []);
      setActiveGuestStudioIds(trainer.activeGuestStudioIds || []);
      setIsVisibleOnCalendar(trainer.isVisibleOnCalendar !== false);
      // String(): older documents stored this as a NUMBER, and the save
      // path calls .trim() on it. Coercing on load both fixes that crash
      // and repairs the row the next time the profile is saved -- which
      // matters because the staff webhook finds a trainer by matching this
      // field, and Firestore's == is type-strict.
      setMindbodyStaffId(String(trainer.mindbodyStaffId ?? ""));
    }
  }, [trainer, isOpen]);

  // Auto-fetch Mindbody staff list when modal opens or studio changes
  useEffect(() => {
    if (isOpen) {
      handleFetchStaff();
    }
  }, [isOpen, primaryHomeStudioId]);

  const handleAccessibleStudioToggle = (studioId: string) => {
    setAccessibleStudioIds((prev) =>
      prev.includes(studioId)
        ? prev.filter((id) => id !== studioId)
        : [...prev, studioId],
    );
  };

  const handleGuestStudioToggle = (studioId: string) => {
    setActiveGuestStudioIds((prev) =>
      prev.includes(studioId)
        ? prev.filter((id) => id !== studioId)
        : [...prev, studioId],
    );
  };

  const { success: toastSuccess, error: toastError } = useToast();

  const handleSave = async () => {
    if (!fullName || !initials || (isAdminMode && !primaryHomeStudioId)) {
      toastError("Validation Error: Missing required fields.");
      return;
    }

    setSaving(true);
    try {
      const searchTokens = generateSearchTokens(fullName);

      const payload: Partial<Trainer> = {
        fullName: fullName.trim(),
        nickname: nickname.trim(),
        initials: initials.trim(),
        email: email.trim(),
        brandColor,
        mindbodyLinked,
        mindbodyStaffId: mindbodyStaffId.trim() || "",
        searchTokens,
      };

      if (isAdminMode) {
        // Force primaryHomeStudioId to be in accessibleStudioIds and filter empty IDs
        const finalAccessible = [
          ...new Set([primaryHomeStudioId, ...accessibleStudioIds]),
        ].filter((id): id is string => Boolean(id && id.trim()));

        const finalGuest = activeGuestStudioIds.filter(
          (id): id is string => Boolean(id && id.trim()),
        );

        payload.role = role;
        payload.requiresPinReset = requiresPinReset;
        payload.primaryHomeStudioId = primaryHomeStudioId;
        payload.accessibleStudioIds = finalAccessible;
        payload.activeGuestStudioIds = finalGuest;
        payload.isVisibleOnCalendar = isVisibleOnCalendar;
      }

      Object.keys(payload).forEach((key) => {
        if ((payload as any)[key] === undefined) {
          delete (payload as any)[key];
        }
      });

      await onSave(payload);
      toastSuccess("Trainer profile updated successfully.");
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to update trainer profile", error);
      toastError("An error occurred while updating the trainer profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-137.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-800 shadow-2xl rounded-3xl overflow-y-auto max-h-[90vh]">
        <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <DialogTitle className="text-2xl font-black italic uppercase text-slate-900 dark:text-white tracking-widest flex items-center gap-2">
            <Users2 className="w-6 h-6 text-[#F06C22]" />
            Edit Trainer Profile
          </DialogTitle>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">
            Updating: {trainer?.fullName || "Staff Profile"}
          </p>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Identity Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest flex items-center gap-1">
                <UserIcon className="w-3 h-3 text-indigo-500" />
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
                className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-11"
                placeholder="e.g. Amanda Jones"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest flex items-center gap-1">
                Nickname
              </Label>
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-11"
                placeholder="e.g. Mandy"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest flex items-center gap-1">
                <Mail className="w-3 h-3 text-indigo-500" />
                Email Address
              </Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-11"
                placeholder="trainer@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">
                Initials
              </Label>
              <Input
                value={initials}
                onChange={(e) => setInitials(e.target.value.toUpperCase())}
                className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-11 uppercase font-bold"
                placeholder="AJ"
                maxLength={3}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">
                Profile Color (Calendar)
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="p-1 h-11 w-16 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer"
                />
                <Input
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-11 font-mono text-sm"
                  placeholder="#000000"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  Mindbody Linked
                </span>
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                  Is this account synced with Mindbody
                </p>
              </div>
              <Switch
                checked={mindbodyLinked}
                onCheckedChange={setMindbodyLinked}
              />
            </div>
          </div>

          {/* Mindbody Staff ID for API sync */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest flex items-center gap-1">
                <Eye className="w-3 h-3 text-orange-500" />
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
                }}
              >
                <SelectTrigger className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-11 text-sm font-bold w-full">
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
                      <div className="flex items-center justify-between w-full gap-4 text-xs sm:text-sm">
                        <span className="font-extrabold text-slate-900 dark:text-white truncate">
                          {s.fullName}
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
                className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-11 font-mono text-sm"
                placeholder="e.g. 100000123"
              />
            )}
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">
              Select or enter the Staff ID assigned in Mindbody. Required for
              API schedule sync.
            </p>
          </div>

          {isAdminMode && (
            <>
              {/* Role selector & visibility */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="space-y-2">
                  <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest flex items-center gap-1">
                    <Shield className="w-3 h-3 text-indigo-500" />
                    Permissions Role
                  </Label>
                  <Select
                    value={role}
                    onValueChange={(val) => setRole(val as UserRole)}
                  >
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-11 text-sm font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700 font-sans">
                      <SelectItem value="LifeTransformer" className="font-bold">
                        Life Transformer
                      </SelectItem>
                      <SelectItem value="StudioLeader" className="font-bold">
                        Studio Leader
                      </SelectItem>
                      <SelectItem value="Owner" className="font-bold">
                        Owner
                      </SelectItem>
                      <SelectItem value="Founder" className="font-bold">
                        Founder
                      </SelectItem>
                      <SelectItem value="Admin" className="font-bold">
                        Admin
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-indigo-500" />
                    Primary Studio
                  </Label>
                  <Select
                    value={primaryHomeStudioId}
                    onValueChange={setPrimaryHomeStudioId}
                  >
                    <SelectTrigger className="bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl h-11 text-sm font-bold">
                      <SelectValue placeholder="Select primary home studio">
                        {studios.find(
                          (s) =>
                            s.id === primaryHomeStudioId ||
                            s.name?.toLowerCase() ===
                              primaryHomeStudioId?.toLowerCase(),
                        )?.name || primaryHomeStudioId}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700 font-sans max-h-62.5">
                      {studios.map((s) => (
                        <SelectItem
                          key={s.id}
                          value={s.id || ""}
                          className="font-bold"
                        >
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Visibility and custom toggles */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-[#F06C22]" /> Display on
                    Calendar
                  </span>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                    Should clients/staff see this trainer on the booking
                    calendar
                  </p>
                </div>
                <Switch
                  checked={isVisibleOnCalendar}
                  onCheckedChange={setIsVisibleOnCalendar}
                />
              </div>

              {/* PIN Lock Security */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Key className="w-4 h-4 text-[#F06C22]" /> Force PIN Reset
                    </span>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                      Trainer will be prompted to choose a new PIN code on next
                      login
                    </p>
                  </div>
                  <Switch
                    checked={requiresPinReset}
                    onCheckedChange={setRequiresPinReset}
                  />
                </div>
              </div>

              {/* Complex Studio Involvements */}
              <div className="space-y-4 pt-2">
                <h4 className="text-xs font-black uppercase italic tracking-widest text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-1.5 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-indigo-500" />
                  Studio Involvements & Connections
                </h4>

                {/* Permanent Accessible Studios */}
                <div className="space-y-2">
                  <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">
                    Permanent Staff Access (Accessible Studios)
                  </Label>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-2">
                    Allows editing, clock-in, and full scheduling control at
                    these facilities.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 dark:bg-slate-800/20 p-3 rounded-2xl border border-slate-100 dark:border-slate-800">
                    {studios.map((s) => {
                      const isPrimary = s.id === primaryHomeStudioId;
                      const isChecked =
                        isPrimary || accessibleStudioIds.includes(s.id || "");
                      return (
                        <div
                          key={`access-${s.id}`}
                          className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all ${
                            isPrimary
                              ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200/50 dark:border-indigo-800/40 opacity-80"
                              : isChecked
                                ? "bg-slate-100/80 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                                : "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700"
                          }`}
                        >
                          <Checkbox
                            id={`access-${s.id}`}
                            checked={isChecked}
                            disabled={isPrimary}
                            onCheckedChange={() =>
                              s.id && handleAccessibleStudioToggle(s.id)
                            }
                            className="rounded border-slate-300 dark:border-slate-700 data-[state=checked]:bg-[#F06C22] data-[state=checked]:border-[#F06C22]"
                          />
                          <label
                            htmlFor={`access-${s.id}`}
                            className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer select-none flex-1 truncate"
                          >
                            {s.name}
                            {isPrimary && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] bg-indigo-500/10 text-indigo-500 font-extrabold uppercase">
                                Home
                              </span>
                            )}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Temporary/Active Guest Involvements */}
                <div className="space-y-2 pt-2">
                  <Label className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest">
                    Active Guest Access (Guest Studios)
                  </Label>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-2">
                    Temporary access or subbing privileges at designated
                    studios.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 dark:bg-slate-800/20 p-3 rounded-2xl border border-slate-100 dark:border-slate-800">
                    {studios.map((s) => {
                      const isChecked = activeGuestStudioIds.includes(
                        s.id || "",
                      );
                      return (
                        <div
                          key={`guest-${s.id}`}
                          className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all ${
                            isChecked
                              ? "bg-slate-100/80 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                              : "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700"
                          }`}
                        >
                          <Checkbox
                            id={`guest-${s.id}`}
                            checked={isChecked}
                            onCheckedChange={() =>
                              s.id && handleGuestStudioToggle(s.id)
                            }
                            className="rounded border-slate-300 dark:border-slate-700 data-[state=checked]:bg-[#F06C22] data-[state=checked]:border-[#F06C22]"
                          />
                          <label
                            htmlFor={`guest-${s.id}`}
                            className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer select-none flex-1 truncate"
                          >
                            {s.name}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="text-[11px] font-black uppercase tracking-widest h-12 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !fullName || !initials}
            className="bg-[#F06C22] hover:bg-[#d95b16] text-white font-black uppercase text-xs h-12 rounded-xl transition-all shadow-[0_0_20px_rgba(240,108,34,0.3)] min-w-37.5"
          >
            {saving ? "Saving Changes..." : "Save Trainer Profile"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
