# Presentation views — draft

## Agreed direction

Tournament setup can use a compact settings page. During the event, wheels and rankings should have dedicated presentation views that make effective use of the screen. People need several views they can switch between. Wheel views are separate from the settings area. Elimination and duel stages have their own tabs named after the configured stages; the progression view remains available as an overview.

The [station view](station-view.md), [combined monitor view](monitor-view.md), and [progression view](progression-view.md) describe the existing functional requirements. Viewers select views by clicking; the optional follow-updates mode highlights updates while keeping the current view in place.

## Candidate views for discussion

- **Game draw:** a large animated wheel for drawing a station game, with the draw outcome and confirmation controls where appropriate.
- **Station:** the station's game, active player, attempt entry, and ranking, sized for the device used to operate it.
- **Combined leaderboard:** a screen-filling overall table with points from both stations, the total, and compact station/now-playing information.
- **Tournament progression:** the ordered stages and relevant results, including elimination and the fighting final's score.
- **Setup:** compact administrator controls for configuration and corrections.

Each draw view shows one large wheel at a time, with separate Wheel 1 and Wheel 2 tabs for direct access. Each device chooses its own view independently, using a compact row of tabs. Anyone using the wheel view can spin without administrator access, so the wheel can be operated directly on the big screen. Anyone at the wheel can also confirm the result without administrator access. Editing game pools remains an administrator action. Once confirmed, the wheel stays visible with the selected game prominent until the viewer chooses another view. Each station has a screen-filling ranking view with result-entry controls on that same view. A button can ask the browser to enter or exit full-screen mode. The browser full-screen button is separate from using the available window space.

When a final scoring stage, elimination, duel, or deciding tie-breaker reaches its victory condition, show an in-app celebration with the winner on each viewing device, independently of its selected view. Keep a visible winner control so the celebration can be shown again. Tournament actions do not open browser confirmation dialogs. Score and time corrections use an in-page editor; unsaved station values remain available when switching active players.

## Visual direction

The user prefers a colorful 8-bit arcade look with pixel styling. The rankings can resemble an arcade high-score list. Specific games or machines are not required as references. The user also likes blinking text and animated lights. Use motion for decorative accents, keep tournament information readable, and respect reduced-motion preferences.
