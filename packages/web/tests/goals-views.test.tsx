import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { COLOR_PICKER_PRESETS } from '@veyra/core/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorPicker } from '../src/components/ColorPicker';
import { GoalChip, GoalKindIconBadge } from '../src/components/GoalChip';
import { goalTint } from '../src/components/goalTint';

afterEach(() => {
  cleanup();
});

describe('ColorPicker', () => {
  it('renders all 12 curated presets plus custom slot and applies valid custom hex', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#5E6AD2" onChange={onChange} label="Color" />);

    // All 12 curated presets exist as buttons
    for (const preset of COLOR_PICKER_PRESETS) {
      expect(screen.getByRole('button', { name: new RegExp(preset.name, 'i') })).toBeInTheDocument();
    }

    // Selected preset uses inside-aligned border ring
    const selectedSwatch = screen.getByRole('button', { name: /Indigo/i });
    expect(selectedSwatch).toHaveAttribute('aria-pressed', 'true');
    expect(selectedSwatch.className).toContain('border-2');
    expect(selectedSwatch.className).toContain('box-border');

    // Select preset Sky
    await user.click(screen.getByRole('button', { name: /Sky/i }));
    expect(onChange).toHaveBeenCalledWith('#4DA3FF');

    // Toggle custom hex row via 13th custom slot
    const customSlot = screen.getByRole('button', { name: /Custom hex/i });
    await user.click(customSlot);

    const hexInput = screen.getByRole('textbox', { name: /Hex color/i });
    await user.clear(hexInput);
    await user.type(hexInput, '#12ab34');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith('#12AB34');
  });

  it('shows a quiet inline hint on invalid custom hex without crashing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#5E6AD2" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Custom hex/i }));
    const hexInput = screen.getByRole('textbox', { name: /Hex color/i });
    await user.clear(hexInput);
    await user.type(hexInput, 'not-a-hex');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/valid hex/i)).toBeInTheDocument();
  });
});

describe('GoalChip and GoalKindIconBadge', () => {
  it('renders Person icon for personal goals and Briefcase icon for company goals with no plain dot', () => {
    const { container } = render(
      <div>
        <GoalChip name="Deep Craft" kind="personal" color="#4DA3FF" />
        <GoalChip name="askLio Launch" kind="company" color="#34D399" />
      </div>,
    );

    const personalBadge = container.querySelector('[data-goal-kind="personal"]');
    const companyBadge = container.querySelector('[data-goal-kind="company"]');

    expect(personalBadge).toBeInTheDocument();
    expect(companyBadge).toBeInTheDocument();
    expect(personalBadge?.querySelector('svg')).toBeInTheDocument();
    expect(companyBadge?.querySelector('svg')).toBeInTheDocument();

    // No plain dot markers
    expect(container.querySelector('.rounded-full.w-1\\.5')).not.toBeInTheDocument();

    // Tinted styles match goalTint
    const skyTint = goalTint('#4DA3FF');
    expect(skyTint.text).toBe('#8FC7FF');
    const mintTint = goalTint('#34D399');
    expect(mintTint.text).toBe('#7EE8BE');

    expect(screen.getByText('Deep Craft')).toBeInTheDocument();
    expect(screen.getByText('askLio Launch')).toBeInTheDocument();
  });

  it('supports xs, sm, md, lg sizes on GoalKindIconBadge', () => {
    const { container } = render(
      <div>
        <GoalKindIconBadge kind="personal" color="#5E6AD2" size="xs" />
        <GoalKindIconBadge kind="company" color="#F59E0B" size="lg" />
      </div>,
    );
    expect(container.querySelectorAll('[data-goal-kind]').length).toBe(2);
  });
});
