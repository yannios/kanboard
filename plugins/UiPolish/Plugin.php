<?php

namespace Kanboard\Plugin\UiPolish;

use Kanboard\Core\Plugin\Base;

/**
 * UiPolish
 *
 * Modern design layer for Kanboard: local Inter font, refreshed palette,
 * modern buttons / forms / tables / board cards / modal.
 *
 * Kept as a separate plugin so it survives Kanboard core upgrades and can be
 * switched off by deleting or renaming this folder.
 */
class Plugin extends Base
{
    public function initialize()
    {
        $this->hook->on('template:layout:css', [
            'template' => 'plugins/UiPolish/Assets/css/ui-hermes.css',
        ]);
    }

    public function getPluginName()
    {
        return 'UiPolish';
    }

    public function getPluginDescription()
    {
        return 'Modern design layer: Inter font, refined palette, modern components.';
    }

    public function getPluginAuthor()
    {
        return 'Jogi / Hermes';
    }

    public function getPluginVersion()
    {
        return '1.0.0';
    }

    public function getCompatibleVersion()
    {
        return '>=1.2.47';
    }
}
