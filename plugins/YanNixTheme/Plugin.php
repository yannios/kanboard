<?php

namespace Kanboard\Plugin\YanNixTheme;

use Kanboard\Core\Plugin\Base;

/**
 * YanNix Theme
 *
 * A modern skin for Kanboard: local Inter font, a warm paper light theme and a
 * gold-on-navy dark theme, flat surfaces (single hairline borders, no shadows),
 * line icons, and a sidebar that marks state with shading only.
 *
 * Everything lives in this folder, so the theme survives a Kanboard upgrade and
 * can be switched off by renaming or deleting the folder. No core file is
 * touched.
 */
class Plugin extends Base
{
    public function initialize()
    {
        $this->hook->on('template:layout:css', [
            'template' => 'plugins/YanNixTheme/Assets/css/yanix-theme.css',
        ]);
    }

    public function getPluginName()
    {
        return 'YanNix Theme';
    }

    public function getPluginDescription()
    {
        return 'Modern flat skin: Inter font, light and dark palettes, hairline borders, no shadows.';
    }

    public function getPluginAuthor()
    {
        return 'Yogi (yannios)';
    }

    public function getPluginVersion()
    {
        return '1.0.0';
    }

    public function getPluginHomepage()
    {
        return 'https://github.com/yannios/kanboard';
    }

    public function getCompatibleVersion()
    {
        return '>=1.2.47';
    }
}
