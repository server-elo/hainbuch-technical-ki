import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { FileUp, X, Loader2, Target, Settings, Building2, FileText, Hash } from 'lucide-react';
import type { AssessmentData } from '../types';

interface AssessmentFormProps {
  onSubmit: (data: AssessmentData, imageFile: File | null) => void;
  onClose: () => void;
}

const inputCls =
  'w-full bg-white border border-neutral-300 rounded-lg px-4 py-3 text-sm text-neutral-800 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600/30 transition-colors placeholder:text-neutral-400';

export default function AssessmentForm({ onSubmit, onClose }: AssessmentFormProps) {
  const [formData, setFormData] = useState<AssessmentData>({
    machineType: '',
    projectRequirements: '',
    technicalConstraints: '',
    desiredOutcomes: '',
    budget: ''
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const isFormValid = imageFile !== null || Object.values(formData).some(val => (val as string).trim() !== '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    setIsSubmitting(true);
    setTimeout(() => {
      onSubmit(formData, imageFile);
    }, 400);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/40 backdrop-blur-sm overflow-y-auto"
    >
      <motion.div
        initial={{ y: 40, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        className="bg-white border border-neutral-200 rounded-xl w-full max-w-2xl my-auto overflow-hidden shadow-xl relative"
      >
        <div className="flex justify-between items-center px-6 py-5 border-b border-neutral-200">
          <div>
            <h2 className="text-lg font-bold text-neutral-900 tracking-tight">Technisches Assessment</h2>
            <p className="text-sm text-neutral-500">Details für eine präzise Empfehlung — alle Felder optional.</p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 transition-colors hover:bg-neutral-100 p-2 rounded-full"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-neutral-700 flex items-center gap-2">
                <Building2 size={15} className="text-neutral-400" />
                Maschine / Spindel
              </label>
              <input
                type="text"
                name="machineType"
                value={formData.machineType}
                onChange={handleInputChange}
                placeholder="z.B. DMG Mori NLX 2500, A2-8 Spindel"
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-neutral-700 flex items-center gap-2">
                <Hash size={15} className="text-neutral-400" />
                Stückzahl / Losgröße
              </label>
              <input
                type="text"
                name="budget"
                value={formData.budget}
                onChange={handleInputChange}
                placeholder="z.B. 200 Stück, Serie monatlich"
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium text-neutral-700 flex items-center gap-2">
                <Target size={15} className="text-neutral-400" />
                Werkstück & Anforderungen
              </label>
              <textarea
                name="projectRequirements"
                value={formData.projectRequirements}
                onChange={handleInputChange}
                placeholder="Werkstück, Maße, Toleranzen/Passungen, Werkstoff, Außen-/Innenspannung, Stangenarbeit…"
                rows={3}
                className={`${inputCls} resize-none`}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-neutral-700 flex items-center gap-2">
                <Settings size={15} className="text-neutral-400" />
                Randbedingungen
              </label>
              <textarea
                name="technicalConstraints"
                value={formData.technicalConstraints}
                onChange={handleInputChange}
                placeholder="Genauigkeit, max. Drehzahl, Störkonturen, Kühlung…"
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-neutral-700 flex items-center gap-2">
                <Target size={15} className="text-neutral-400" />
                Ziele
              </label>
              <textarea
                name="desiredOutcomes"
                value={formData.desiredOutcomes}
                onChange={handleInputChange}
                placeholder="Schneller Rüsten, höhere Spannkraft, Automation…"
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </div>

          </div>

          <div className="space-y-2 pt-1">
            <label className="text-sm font-medium text-neutral-700 flex items-center gap-2">
              <FileUp size={15} className="text-neutral-400" />
              Technische Zeichnung (optional)
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                imagePreview ? 'border-red-500 bg-red-50/50' : 'border-neutral-300 bg-neutral-50 hover:bg-white hover:border-neutral-400'
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageChange}
                accept="image/*,application/pdf"
                className="hidden"
              />
              {imagePreview ? (
                <div className="space-y-3">
                  {imageFile?.type === 'application/pdf' ? (
                    <div className="w-14 h-14 rounded bg-red-50 flex items-center justify-center mx-auto text-red-600 border border-red-200">
                      <FileText size={28} />
                    </div>
                  ) : (
                    <img src={imagePreview} alt="Vorschau" className="max-h-32 mx-auto rounded border border-neutral-200" />
                  )}
                  <p className="text-sm text-red-600 font-medium">{imageFile?.name || 'Datei'} angehängt — klicken zum Ersetzen.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-11 h-11 rounded-full bg-white border border-neutral-200 flex items-center justify-center mx-auto text-neutral-400">
                    <FileUp size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-700">Zeichnung hochladen</p>
                    <p className="text-xs text-neutral-400 mt-0.5">PNG, JPG, WebP oder PDF</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-neutral-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-lg text-sm font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition-colors disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !isFormValid}
              className="px-6 py-2.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-40 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={15} className="animate-spin" />}
              {isSubmitting ? 'Wird gesendet…' : 'Analyse starten'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
