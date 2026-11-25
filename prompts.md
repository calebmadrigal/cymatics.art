# Prompts used in building this app.

## Prompt 1 (executed with ChatGPT Sol 6.1 High)

Built a new Single-File Web App in the directory, /Users/caleb/Repos/cymatics.art, called Cymatics.Art. Model it on FuzzyGraph (/Users/caleb/Repos/fuzzygraph). Use the same type of build pipeline, directory setup, and visual style. The goal of this app is to be a Digital Cymatics system. Also keep the coding style like FuzzyGraph.

The goal of this is to build something like a more advanced version of the Digital Cymatics Equation Generator in FuzzyGraph, with a major addition: boundaries. The Boundary defined in the Boundary section of the side bar should result in the visualization of the wave interference equation. The idea is that this should work like in the Digital Cymatics Equation Generator in FuzzyGraph, but the patterns should be mirrored/reflected by the boundaries when they are encountered. But the reflected values should also interfere (using the combine operator method).

The top bar should remain similar. Instead of the "Fuzzy Graph" title, make it "Cymatics.art". Keep the Downlaod button, Share button, Save button, Open button, and Help button, along with their functionality. Assume that the main url will be "cymatics.app".

Keep the Basic/Advanced slider. When in Advanced mode, the Resonators section controls (with the exception of the "Combine operator" (which should remain in place) should be replace with a list of items  with the buttons below "Add", "Edit"", and "Remove". When "Add" is clicked, a modal input (like in FuzzyGraph) should come up which allows the user to add a new resonator with the normal resonator controls, and additional x and y inputs.

Resonators should be stored in a "resonators_list", which is a list of JSON objects. The JSON object should be how the resonators are stored. It should be a list of json objects in this form: {"x": 1.2, "y": 1.2, "amplitude": 7.5, "frequency": 2.5, "phase_multiplier": 0, "phase_offset": 1.571,  "waveform": "sinc"}.

The content of the left sidebar should include the following sections and controls...

Section: Resonators (this section should work like the Digital Cymatics Equation Generator in FuzzyGraph)
- Visual representation of the position of resonator (this is like the visual representation in the Digital Cymatics Equation Generator), but it should also show the boundary (configured in the Boundary section)
- Number of resonators
- Distance from Center
- Amplitude
- Frequency
- Phase Multiplier (1 by default)
- Combine operator (can be "+", "-", "*", or "/").
- Waveform (options should be sinc, sine, square, sawtooth, triangle)

Section: Boundary
- Should be a dropdown with the following values: None, Circle, Binary Split, Triangle, Square, Pentagon, Hexagon, Septagon, Octongon, 9-sides, 10-sides, 11-sides, 12-sides, Custom
    * if Custom selected, user can enter number of sides, an input that takes an interger input should appear below the dropdown where a user can enter the number of sides of the boundary.
    * if None is selected, no boundary is enforced.
- Radius - this should be a floating point numeric input that represents how big the boundary is.

Section: Phase

- Fixed | Animated radio button. If Animated, then the Steps and Speed field below should appear. If fixed, then a Phase text input should appear below. Phase values should be between 0 and 2pi.
- Steps
    * This represents the number of values that phase should be set to. Should be space equally between 0 and 2pi.
- Speed
    * This represents how quickly the phase should move between values.
- Phase
    * A fixed phase that should apply to all resonators. Phase for each value should be calculated by multiplying the current phase value by the phase_multiplier (plus the phase_offset value).

Section: View Controls
- Fuzzy Level (should work like FuzzyGraph)
- Min Override (like in FuzzyGraph)
- Max Override (like in FuzzyGraph)
- Rotation (like in FuzzyGraph)

Section: Color Map
- Color map dropdown (like in FuzzyGraph)
- Reverse Color slider (like in FuzzyGraph)
- Invert Color slider (like in FuzzyGraph)
- Color Start
- Color Cycles
- Hue Shift
- Saturation
- Luminosity

* The "≈ Built by Caleb Madrigal ≈" text at the bottom of the sidebar should be in this new sidebar.

In the main view area, there should be a similar +, -, home, and goto buttons. Also keep the drag to reposition functionality intact. GLSL should be used as in fuzzygraph for rendering the canvas.


## Prompt 2 (executed with ChatGPT Sol 6.1 High)

Add a Rotation field in the Resonators section (which rotates the resonators), add a Rotation field in the Boundary section (which rotates the boundary), and add a Play/Pause button as a new button over the main view area. Make it play by default. If playing, a pause icon should be visible, and if paused, a play icon should appear. Play sets the Phase value to Animated, and Pause sets it to Fixed. Also change the "Color Map" section to be instead called "Color", and add a Background Color field that sets the background color for what is behind the boundary.

## Prompt 3 (executed with ChatGPT Sol 6.1 High)

Set the defaults to the following: 6 resonators, distance from center = 2, amplitude = 1, frequency = 3, phase multiplier = -1, rotation (for resonators) = 90, for boundary, set shape to hexagon, radius to 4, and rotation to 90 degrees. For Phase, set to 30 steps, speed = 30.

## Prompt 4 (executed with ChatGPT Sol 6.1 High)

Change default boundary to "Binary split"


