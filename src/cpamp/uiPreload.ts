/**
 * MrBlank: load CPAMP UI primitives (and their CSS modules) before any feature page.
 * In CPAMP these are pulled in by the app shell first, so page-level module rules such as
 * `.pageSizeSelectTrigger` cascade after `Select.module.scss`. Mirror that order here.
 */
import './components/ui/Button';
import './components/ui/Card';
import './components/ui/Drawer';
import './components/ui/DropdownMenu';
import './components/ui/EmptyState';
import './components/ui/HeaderInputList';
import './components/ui/InfoTooltip';
import './components/ui/Input';
import './components/ui/Modal';
import './components/ui/ModelInputList';
import './components/ui/Select';
import './components/ui/SelectionCheckbox';
import './components/ui/ToggleSwitch';
