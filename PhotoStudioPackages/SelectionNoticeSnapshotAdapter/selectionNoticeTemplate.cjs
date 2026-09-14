'use strict';

const TONE_PRESETS = Object.freeze({
  formal: Object.freeze({
    greeting: 'Hello',
    intro: 'Your edited gallery for',
    selectionLead: 'Please review the gallery and confirm your selected images',
    methodLead: 'Selection method',
    noteLead: 'Additional note',
    closing: 'Thank you. Once we receive your selections, we will continue with the next stage of delivery.'
  }),
  friendly: Object.freeze({
    greeting: 'Hi',
    intro: 'The edited gallery for',
    selectionLead: 'Take a look and mark your favorite images',
    methodLead: 'How to select',
    noteLead: 'Extra note',
    closing: 'Once your selections are in, we can move on to the next step.'
  }),
  warm: Object.freeze({
    greeting: 'Hi',
    intro: 'The edited gallery for',
    selectionLead: 'When you have a moment, review the gallery and mark the images you would like to keep',
    methodLead: 'How to select',
    noteLead: 'A note for you',
    closing: 'Thank you for taking the time to review the gallery. Once your selections are in, we will prepare the next step.'
  })
});

function buildIntroLine(preset, tone, projectName) {
  if (tone === 'formal') {
    return `${preset.intro} "${projectName}" is ready for image selection.`;
  }
  if (tone === 'friendly') {
    return `${preset.intro} "${projectName}" is ready for you to review.`;
  }
  return `${preset.intro} "${projectName}" is ready whenever you are.`;
}

function buildSelectionDeadlineLine(selectionLead, selectionDeadline, tone) {
  if (selectionDeadline) {
    return `${selectionLead} by ${selectionDeadline}.`;
  }

  if (tone === 'warm') {
    return `${selectionLead}.`;
  }

  return `${selectionLead} when convenient.`;
}

function buildSelectionNotice({
  customerName,
  project,
  tone,
  selectionDeadline,
  selectionMethod,
  noteToClient
}) {
  const preset = TONE_PRESETS[tone] || TONE_PRESETS.warm;
  const lines = [
    `${preset.greeting} ${customerName},`,
    buildIntroLine(preset, tone, project.project_name),
    buildSelectionDeadlineLine(preset.selectionLead, selectionDeadline, tone),
    selectionMethod ? `${preset.methodLead}: ${selectionMethod}` : null,
    noteToClient ? `${preset.noteLead}: ${noteToClient}` : null,
    preset.closing
  ].filter(Boolean);

  return lines.join('\n\n');
}

module.exports = {
  TONE_PRESETS,
  buildSelectionNotice
};
