import { useUIStore } from '../state/useUIStore';
import { useToastStore } from '../state/useToastStore';
import { MotionCaptureManager } from '../utils/motionCapture';

interface CalibrationWizardProps {
  manager: MotionCaptureManager | null;
}

const BODY_STEPS = [
  {
    title: "Step 1: Body Alignment",
    instruction: "Stand straight in a T-Pose. Ensure your arms are horizontal and your feet are shoulder-width apart.",
    actionLabel: "Capture T-Pose",
    type: 'body' as const,
  },
  {
    title: "Step 2: Eye Calibration",
    instruction: "Look directly at the center of your screen (at your avatar's face). Keep your head neutral.",
    actionLabel: "Capture Gaze Center",
    type: 'face' as const,
  },
  {
    title: "Step 3: Ready!",
    instruction: "Your tracking is now calibrated. You can now move naturally.",
    actionLabel: "Finish Wizard",
    type: 'finish' as const,
  },
];

const FACE_STEPS = [
  {
    title: "Step 1: Neutral Face",
    instruction: "Sit still, look at the camera, and keep a relaxed face. This becomes the rest pose so blinks and smiles start from zero.",
    actionLabel: "Capture Neutral Face",
    type: 'face' as const,
  },
  {
    title: "Step 2: Gaze Center",
    instruction: "Keep looking at the camera without turning your head. This centers eye look-left / look-right.",
    actionLabel: "Capture Gaze Center",
    type: 'face' as const,
  },
  {
    title: "Step 3: Ready!",
    instruction: "Face-only tracking is calibrated. Expressions use ARKit-named blendshapes mapped onto your VRM.",
    actionLabel: "Finish Wizard",
    type: 'finish' as const,
  },
];

export function CalibrationWizard({ manager }: CalibrationWizardProps) {
  const { isCalibrationActive, calibrationStep, calibrationKind, setCalibrationStep, endCalibration } = useUIStore();
  const { addToast } = useToastStore();

  if (!isCalibrationActive) return null;

  const steps = calibrationKind === 'face' ? FACE_STEPS : BODY_STEPS;
  const currentStep = steps[calibrationStep] || steps[0];
  const progress = Math.min((calibrationStep + 1) / steps.length, 1);

  const handleAction = () => {
    if (!manager) {
      addToast("Error: Motion Capture Manager not found.", "error");
      return;
    }

    try {
      if (currentStep.type === 'body') {
        manager.calibrateBody();
        addToast("Body offsets captured!", "success");
        setCalibrationStep(Math.min(calibrationStep + 1, steps.length - 1));
      } else if (currentStep.type === 'face') {
        manager.calibrateFace();
        if (calibrationKind === 'face') {
          manager.calibrateFaceMaskNeutral();
        }
        addToast(calibrationKind === 'face' ? "Neutral face captured!" : "Face/Gaze center captured!", "success");
        setCalibrationStep(Math.min(calibrationStep + 1, steps.length - 1));
      } else {
        endCalibration();
        addToast("Calibration complete!", "success");
      }
    } catch (e) {
      console.error('[CalibrationWizard] Calibration failed:', e);
      addToast("Calibration failed. Check console.", "error");
    }
  };

  return (
    <div className="modal-overlay" onClick={endCalibration}>
      <div className="modal-content calibration-wizard" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={endCalibration} aria-label="Close calibration wizard">
          &times;
        </button>

        <div className="calibration-wizard__meta">
          <span className="calibration-wizard__eyebrow">
            {calibrationKind === 'face' ? 'Face-Only Setup' : 'Mocap Setup'}
          </span>
          <span className="calibration-wizard__step">
            Step {Math.min(calibrationStep + 1, steps.length)} of {steps.length}
          </span>
        </div>

        <div className="progress-bar" aria-hidden="true" style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>
          <div className="progress-bar__fill" style={{ width: `${progress * 100}%` }} />
        </div>

        <h2 className="calibration-wizard__title">{currentStep.title}</h2>
        <p className="calibration-wizard__instruction">{currentStep.instruction}</p>

        <div className="onboarding-actions">
          <button
            className="primary large full-width"
            onClick={handleAction}
            disabled={!manager}
          >
            {manager ? currentStep.actionLabel : "Camera Not Active"}
          </button>
        </div>

        {calibrationStep === 0 && (
          <p className="muted small calibration-wizard__tip">
            {calibrationKind === 'face'
              ? 'Tip: Use the front camera, even lighting, and keep your whole face in frame.'
              : 'Tip: Ensure your webcam has a clear view of your upper body and good lighting.'}
          </p>
        )}
      </div>
    </div>
  );
}
