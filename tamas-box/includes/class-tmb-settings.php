<?php
/**
 * Settings storage, defaults, migration and sanitization.
 *
 * Structure (v3):
 *   tmb_settings = array(
 *       'enabled'    => 1,          // master switch
 *       'direction'  => 'rtl',
 *       'z_index'    => 99990,
 *       'custom_css' => '',
 *       ... behaviour ...
 *       'boxes'      => array( box, box, ... )
 *   )
 *
 * @package Tamas_Box
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TMB_Settings {

	/**
	 * Available button positions.
	 *
	 * @return array
	 */
	public static function positions() {
		return array(
			'top-left'      => __( 'بالا چپ', 'tamas-box' ),
			'top-center'    => __( 'بالا وسط', 'tamas-box' ),
			'top-right'     => __( 'بالا راست', 'tamas-box' ),
			'middle-left'   => __( 'وسط چپ', 'tamas-box' ),
			'middle-right'  => __( 'وسط راست', 'tamas-box' ),
			'bottom-left'   => __( 'پایین چپ', 'tamas-box' ),
			'bottom-center' => __( 'پایین وسط', 'tamas-box' ),
			'bottom-right'  => __( 'پایین راست', 'tamas-box' ),
		);
	}

	/**
	 * Global (non box specific) defaults.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			/* کلی */
			'enabled'         => 1,
			'direction'       => 'rtl',   // rtl | ltr | auto
			'font_family'     => 'inherit',
			'z_index'         => 99990,
			'custom_css'      => '',

			/* رفتار مشترک */
			'open_on_load'    => 0,
			'open_delay'      => 0,
			'close_on_scroll' => 0,
			'remember_state'  => 0,
			'overlay_color'   => 'rgba(15,23,42,.45)',
			'overlay_desktop' => 0,

			/* باکس‌ها */
			'boxes'           => array( self::box_defaults() ),

			/* چت آنلاین (نسخه ۳.۲) */
			'chat'            => self::chat_defaults(),
		);
	}

	/**
	 * Defaults of the live chat module.
	 *
	 * @param array $over Overrides.
	 * @return array
	 */
	public static function chat_defaults( $over = array() ) {
		$chat = array(
			/* کلی */
			// On by default: a contact plugin that ships a chat tab is meant to be used,
			// and a chat item that renders while the module is off is a dead button.
			'enabled'             => 1,
			'launcher'            => 'item',      // item | button | both
			'launcher_position'   => 'bottom-left',
			'launcher_offset_x'   => 20,
			'launcher_offset_y'   => 20,
			'launcher_mobile_y'   => 88,
			'launcher_icon'       => 'chat',
			'launcher_text'       => 'چت آنلاین',
			'launcher_show_text'  => 0,
			'launcher_color_1'    => '#c99a5b',
			'launcher_color_2'    => '#a97c3f',
			'launcher_fg'         => '#ffffff',
			'launcher_pulse'      => 0,
			'badge'               => 1,
			'sound'               => 0,
			'auto_open'           => 0,
			'auto_open_delay'     => 8,
			'poll_interval'       => 5,
			'poll_closed'         => 60,

			/* متن‌ها */
			'title'               => 'چت آنلاین',
			'subtitle'            => 'پشتیبانی سایت',
			'greeting'            => 'سلام! 👋 سؤال یا درخواست خود را بنویسید؛ پاسخ شما در همین پنجره نمایش داده می‌شود.',
			'placeholder'         => 'پیام خود را بنویسید…',
			'send_label'          => 'ارسال',
			'agent_label'         => 'پشتیبانی',
			'visitor_label'       => 'شما',
			'online_text'         => 'آنلاین — معمولاً سریع پاسخ می‌دهیم',
			'offline_text'        => 'الان آنلاین نیستیم',
			'offline_notice'      => 'پیام شما ذخیره شد و در اولین فرصت پاسخ داده می‌شود.',
			'closed_notice'       => 'این گفتگو بسته شد. برای شروع دوباره روی «گفتگوی جدید» بزنید.',
			'rate_notice'         => 'تعداد پیام‌ها زیاد است؛ چند لحظه صبر کنید.',
			'typing_text'         => 'در حال نوشتن…',
			'powered_by'          => 1,
			'allow_new_chat'      => 1,

			/* فرم پیش از گفتگو */
			'prechat_enabled'     => 0,
			'prechat_name'        => 1,
			'prechat_phone'       => 1,
			'prechat_required'    => 1,
			'prechat_title'       => 'برای شروع گفتگو، اطلاعات خود را وارد کنید',
			'prechat_name_label'  => 'نام و نام خانوادگی',
			'prechat_phone_label' => 'شماره تماس',
			'prechat_button'      => 'شروع گفتگو',

			/* قوانین */
			'max_length'          => 1000,
			'rate_limit'          => 8,
			'rate_window'         => 60,
			'retain_days'         => 90,
			'require_login'       => 0,
			'hours_enabled'       => 0,
			'hours_days'          => array(),
			'hours_from'          => '',
			'hours_to'            => '',

			/* ظاهر */
			'width'               => 380,
			'height'              => 560,
			'radius'              => 18,
			'header_bg'           => '#c99a5b',
			'header_text'         => '#ffffff',
			'panel_bg'            => '#f6f7f9',
			'bubble_visitor'      => '#c99a5b',
			'bubble_visitor_text' => '#ffffff',
			'bubble_agent'        => '#ffffff',
			'bubble_agent_text'   => '#1f2937',
			'accent'              => '#c99a5b',
			'text_muted'          => '#6b7280',

			/* بله */
			'bale_enabled'        => 1,
			'bale_token'          => '',
			'bale_api_base'       => 'https://tapi.bale.ai/bot',
			'bale_chat_ids'       => '',
			'bale_secret'         => '',
			'bale_mode'           => 'webhook',   // webhook | poll
			'bale_notify_new'     => 1,
			'bale_include_page'   => 1,
			'bale_include_ip'     => 0,
			'bale_default_reply'  => 1,
			'bale_commands'       => 1,
			'bale_media'          => 1,
			'bale_sync_admin'     => 1,
			'bale_bot_username'   => '',
			'bale_bot_name'       => '',

			/* متفرقه */
			'delete_on_uninstall' => 0,
			'only_admins_reply'   => 1,
		);

		return array_merge( $chat, $over );
	}

	/**
	 * Chat settings of the current option (merged with defaults).
	 *
	 * @return array
	 */
	public static function chat() {
		$settings = self::get();
		return isset( $settings['chat'] ) ? $settings['chat'] : self::chat_defaults();
	}

	/**
	 * Defaults for a single contact box.
	 *
	 * @param array $over Overrides.
	 * @return array
	 */
	public static function box_defaults( $over = array() ) {
		$box = array(
			'id'               => 'box1',
			'name'             => __( 'باکس اصلی', 'tamas-box' ),
			'enabled'          => 1,

			/* موقعیت */
			'position'         => 'bottom-right',
			'offset_x'         => 20,
			'offset_y'         => 20,
			'mobile_offset_y'  => 88,

			/* دکمه */
			'btn_text'         => 'تماس با ما',
			'btn_show_text'    => 1,
			'btn_icon'         => 'chat',
			'btn_size'         => 60,
			'btn_radius'       => 50,
			'btn_color_1'      => '#22c55e',
			'btn_color_2'      => '#16a34a',
			'btn_icon_color'   => '#ffffff',
			'btn_shadow'       => 1,
			'btn_pulse'        => 1,
			'btn_pulse_color'  => '#22c55e',
			'btn_tooltip'      => 'راه‌های ارتباطی',
			'btn_show_tooltip' => 1,

			/* پنل */
			'panel_title'      => 'راه‌های ارتباطی',
			'panel_subtitle'   => 'برای ارتباط با ما یکی از گزینه‌های زیر را انتخاب کنید',
			'panel_show_head'  => 1,
			'panel_bg'         => '#ffffff',
			'panel_text'       => '#1f2937',
			'panel_sub_text'   => '#6b7280',
			'panel_head_bg'    => '#ffffff',
			'panel_head_text'  => '#1f2937',
			'panel_radius'     => 18,
			'panel_width'      => 340,
			'item_bg'          => '#ffffff',
			'item_hover_bg'    => '#f6f6f7',
			'item_divider'     => '#eeeeee',
			'item_text'        => '#1f2937',
			'item_sub_text'    => '#9ca3af',
			'item_style'       => 'row',
			'icon_shape'       => 'circle',
			'icon_size'        => 42,
			'use_brand_colors' => 1,
			'animation'        => 'slide',
			'close_text'       => 'بستن',
			'close_color'      => '#e11d48',
			'close_style'      => 'outline',

			/* نمایش: دستگاه */
			'show_desktop'     => 1,
			'show_mobile'      => 1,

			/* نمایش: صفحات */
			'display_mode'     => 'all',
			'show_types'       => array(),
			'show_ids'         => '',
			'show_post_types'  => array(),
			'show_terms'       => '',
			'hide_types'       => array(),
			'hide_ids'         => '',
			'hide_post_types'  => array(),
			'hide_terms'       => '',
			'url_show'         => '',
			'url_hide'         => '',

			/* نمایش: کاربران */
			'user_mode'        => 'all',
			'user_roles'       => array(),

			/* نمایش: زمان‌بندی */
			'schedule_enabled' => 0,
			'schedule_days'    => array(),
			'schedule_from'    => '',
			'schedule_to'      => '',
			'schedule_ranges'  => array(),

			/* آیتم‌ها */
			'items'            => self::default_items(),
		);

		return array_merge( $box, $over );
	}

	/**
	 * Default contact items.
	 *
	 * @return array
	 */
	public static function default_items() {
		return array(
			array(
				'enabled'      => 1,
				'label'        => 'تماس با فروشگاه',
				'sublabel'     => '',
				'icon'         => 'phone',
				'url'          => 'tel:02112345678',
				'color'        => '#22c55e',
				'custom_color' => 0,
				'new_tab'      => 0,
				'nofollow'     => 0,
				'device'       => 'both',
			),
			array(
				'enabled'      => 1,
				'label'        => 'تماس با پشتیبان فروش',
				'sublabel'     => '',
				'icon'         => 'mobile',
				'url'          => 'tel:09121234567',
				'color'        => '#f59e0b',
				'custom_color' => 0,
				'new_tab'      => 0,
				'nofollow'     => 0,
				'device'       => 'both',
			),
			array(
				'enabled'      => 1,
				'label'        => 'ارتباط از طریق واتساپ',
				'sublabel'     => '',
				'icon'         => 'whatsapp',
				'url'          => 'https://wa.me/989121234567',
				'color'        => '#25D366',
				'custom_color' => 0,
				'new_tab'      => 1,
				'nofollow'     => 1,
				'device'       => 'both',
			),
			array(
				'enabled'      => 1,
				'label'        => 'ارتباط از طریق تلگرام',
				'sublabel'     => '',
				'icon'         => 'telegram',
				'url'          => 'https://t.me/username',
				'color'        => '#229ED9',
				'custom_color' => 0,
				'new_tab'      => 1,
				'nofollow'     => 1,
				'device'       => 'both',
			),
			array(
				'enabled'      => 1,
				'label'        => 'ارتباط از طریق اینستاگرام',
				'sublabel'     => '',
				'icon'         => 'instagram',
				'url'          => 'https://instagram.com/username',
				'color'        => '#E4405F',
				'custom_color' => 0,
				'new_tab'      => 1,
				'nofollow'     => 1,
				'device'       => 'both',
			),
		);
	}

	/**
	 * Get merged settings (runs migration when needed).
	 *
	 * @return array
	 */
	public static function get() {
		$saved = get_option( TMB_OPTION, array() );
		if ( ! is_array( $saved ) ) {
			$saved = array();
		}

		// Migrate legacy (v1/v2) flat structure into the boxes array.
		if ( ! isset( $saved['boxes'] ) && ! empty( $saved ) ) {
			$saved = self::migrate( $saved );
		}

		$settings = wp_parse_args( $saved, self::defaults() );

		// The chat module was added in 3.2 - always merge its own defaults.
		$saved_chat       = ( isset( $saved['chat'] ) && is_array( $saved['chat'] ) ) ? $saved['chat'] : array();
		$settings['chat'] = wp_parse_args( $saved_chat, self::chat_defaults() );

		if ( empty( $settings['boxes'] ) || ! is_array( $settings['boxes'] ) ) {
			$settings['boxes'] = array( self::box_defaults() );
		}

		// Make sure every box has all keys.
		$boxes = array();
		$i     = 0;
		foreach ( $settings['boxes'] as $box ) {
			if ( ! is_array( $box ) ) {
				continue;
			}
			$box = wp_parse_args( $box, self::box_defaults() );
			$i++;
			if ( empty( $box['id'] ) ) {
				$box['id'] = 'box' . $i;
			}
			if ( ! is_array( $box['items'] ) ) {
				$box['items'] = array();
			}
			$boxes[] = $box;
		}
		$settings['boxes'] = $boxes;

		return apply_filters( 'tmb_settings', $settings );
	}

	/**
	 * One time upgrade routine, runs when the stored version is older.
	 *
	 * 3.2.0: switch the live chat module on and give every contact box a
	 * "چت آنلاین" item so the feature is usable right after the update.
	 *
	 * @return void
	 */
	public static function maybe_upgrade() {
		$stored = (string) get_option( 'tmb_version', '' );

		if ( $stored === TMB_VERSION ) {
			return;
		}

		$saved  = get_option( TMB_OPTION, array() );
		$fresh  = ( false === get_option( TMB_OPTION, false ) );

		if ( ! is_array( $saved ) ) {
			$saved = array();
		}

		/*
		 * A brand new install keeps everything as shipped: the admin switches
		 * the module on in the "چت آنلاین" tab and adds the button there.
		 */
		if ( $fresh ) {
			update_option( 'tmb_version', TMB_VERSION );
			return;
		}

		// Legacy (v1/v2) single box -> bring it to the v3 shape first.
		if ( ! isset( $saved['boxes'] ) && ! empty( $saved ) ) {
			$saved = self::migrate( $saved );
		}

		if ( ! isset( $saved['boxes'] ) || ! is_array( $saved['boxes'] ) ) {
			$saved['boxes'] = array( self::box_defaults() );
		}

		$added = false;

		foreach ( $saved['boxes'] as $index => $box ) {
			if ( ! is_array( $box ) ) {
				continue;
			}

			$items = ( isset( $box['items'] ) && is_array( $box['items'] ) ) ? $box['items'] : array();
			$has   = false;

			foreach ( $items as $item ) {
				if ( is_array( $item ) && isset( $item['action'] ) && 'chat' === $item['action'] ) {
					$has = true;
					break;
				}
			}

			if ( $has ) {
				continue;
			}

			// First position: the online chat is the item people should see first.
			array_unshift(
				$items,
				array(
					'enabled'      => 1,
					'action'       => 'chat',
					'label'        => __( 'چت آنلاین', 'tamas-box' ),
					'sublabel'     => __( 'پاسخگویی آنی', 'tamas-box' ),
					'icon'         => 'chat',
					'url'          => '#tmb-chat',
					'color'        => '#c99a5b',
					'custom_color' => 0,
					'new_tab'      => 0,
					'nofollow'     => 0,
					'device'       => 'both',
				)
			);

			$box['items']            = $items;
			$saved['boxes'][ $index ] = $box;
			$added                   = true;
		}

		if ( ! isset( $saved['chat'] ) || ! is_array( $saved['chat'] ) ) {
			$saved['chat'] = array();
		}

		// An existing site gets the module turned on - that is what this update is for.
		if ( empty( $saved['chat']['enabled'] ) ) {
			$saved['chat']['enabled'] = 1;
			$added                    = true;
		}

		if ( $added ) {
			update_option( TMB_OPTION, $saved );
			update_option( 'tmb_chat_upgrade_notice', 1 );
		}

		update_option( 'tmb_version', TMB_VERSION );
	}

	/**
	 * Move every "chat" item to the top of its box.
	 *
	 * @return int Number of boxes that changed.
	 */
	public static function chat_items_first() {
		$raw = get_option( TMB_OPTION, array() );

		if ( ! is_array( $raw ) || empty( $raw['boxes'] ) || ! is_array( $raw['boxes'] ) ) {
			return 0;
		}

		$changed = 0;

		foreach ( $raw['boxes'] as $index => $box ) {
			if ( ! is_array( $box ) || empty( $box['items'] ) || ! is_array( $box['items'] ) ) {
				continue;
			}

			$first = array();
			$rest  = array();

			foreach ( $box['items'] as $item ) {
				if ( is_array( $item ) && isset( $item['action'] ) && 'chat' === $item['action'] ) {
					$first[] = $item;
				} else {
					$rest[] = $item;
				}
			}

			if ( ! $first || ! $rest ) {
				continue;
			}

			$ordered = array_merge( $first, $rest );

			if ( $ordered === array_values( $box['items'] ) ) {
				continue;
			}

			$box['items']         = $ordered;
			$raw['boxes'][ $index ] = $box;
			$changed++;
		}

		if ( $changed ) {
			update_option( TMB_OPTION, $raw );
		}

		return $changed;
	}

	/**
	 * Convert a v1/v2 flat option into the v3 multi-box format.
	 *
	 * @param array $old Old settings.
	 * @return array
	 */
	public static function migrate( $old ) {
		$box_keys = array_keys( self::box_defaults() );
		$box      = array();

		foreach ( $box_keys as $key ) {
			if ( isset( $old[ $key ] ) ) {
				$box[ $key ] = $old[ $key ];
			}
		}

		// Old single "btn_position" (right|left) -> new position key.
		if ( isset( $old['btn_position'] ) ) {
			$box['position'] = ( 'left' === $old['btn_position'] ) ? 'bottom-left' : 'bottom-right';
		}
		if ( isset( $old['btn_offset_x'] ) ) {
			$box['offset_x'] = $old['btn_offset_x'];
		}
		if ( isset( $old['btn_offset_y'] ) ) {
			$box['offset_y'] = $old['btn_offset_y'];
		}

		$box['id']      = 'box1';
		$box['name']    = __( 'باکس اصلی', 'tamas-box' );
		$box['enabled'] = 1;

		$global = array();
		foreach ( array( 'enabled', 'direction', 'font_family', 'z_index', 'custom_css', 'open_on_load', 'open_delay', 'close_on_scroll', 'remember_state', 'overlay_color', 'overlay_desktop' ) as $key ) {
			if ( isset( $old[ $key ] ) ) {
				$global[ $key ] = $old[ $key ];
			}
		}

		$global['boxes'] = array( self::box_defaults( $box ) );

		return $global;
	}

	/**
	 * Sanitize the whole option.
	 *
	 * @param array $input Raw input.
	 * @return array
	 */
	public static function sanitize( $input ) {
		$defaults = self::defaults();
		$out      = array();

		foreach ( array( 'enabled', 'open_on_load', 'close_on_scroll', 'remember_state', 'overlay_desktop' ) as $key ) {
			$out[ $key ] = ! empty( $input[ $key ] ) ? 1 : 0;
		}

		$out['font_family']   = isset( $input['font_family'] ) ? sanitize_text_field( wp_unslash( $input['font_family'] ) ) : $defaults['font_family'];
		$out['overlay_color'] = isset( $input['overlay_color'] ) ? self::sanitize_color( $input['overlay_color'], $defaults['overlay_color'] ) : $defaults['overlay_color'];

		$dir               = isset( $input['direction'] ) ? sanitize_key( $input['direction'] ) : 'rtl';
		$out['direction']  = in_array( $dir, array( 'rtl', 'ltr', 'auto' ), true ) ? $dir : 'rtl';

		$out['z_index']    = max( 1, min( 2147483000, isset( $input['z_index'] ) ? intval( $input['z_index'] ) : 99990 ) );
		$out['open_delay'] = max( 0, min( 120, isset( $input['open_delay'] ) ? intval( $input['open_delay'] ) : 0 ) );
		$out['custom_css'] = isset( $input['custom_css'] ) ? wp_strip_all_tags( wp_unslash( $input['custom_css'] ) ) : '';

		/* ---------------- boxes ---------------- */
		$boxes = array();
		if ( ! empty( $input['boxes'] ) && is_array( $input['boxes'] ) ) {
			$index = 0;
			foreach ( $input['boxes'] as $raw ) {
				if ( ! is_array( $raw ) ) {
					continue;
				}
				$index++;
				$boxes[] = self::sanitize_box( $raw, $index );
			}
		}

		if ( empty( $boxes ) ) {
			$boxes = array( self::box_defaults() );
		}

		$out['boxes'] = $boxes;

		/* ---------------- live chat ---------------- */
		$out['chat'] = self::sanitize_chat(
			( isset( $input['chat'] ) && is_array( $input['chat'] ) ) ? $input['chat'] : array()
		);

		return $out;
	}

	/**
	 * Sanitize the live chat block of the option.
	 *
	 * @param array $raw Raw chat settings.
	 * @return array
	 */
	public static function sanitize_chat( $raw ) {
		$d   = self::chat_defaults();
		$old = self::chat();
		$out = array();

		/* switches */
		$switches = array(
			'enabled', 'launcher_show_text', 'launcher_pulse', 'badge', 'sound', 'auto_open',
			'powered_by', 'allow_new_chat', 'prechat_enabled', 'prechat_name', 'prechat_phone',
			'prechat_required', 'require_login', 'hours_enabled', 'bale_enabled', 'bale_notify_new',
			'bale_include_page', 'bale_include_ip', 'bale_default_reply', 'bale_commands', 'bale_media',
			'bale_sync_admin', 'delete_on_uninstall', 'only_admins_reply',
		);
		foreach ( $switches as $key ) {
			$out[ $key ] = ! empty( $raw[ $key ] ) ? 1 : 0;
		}

		/* single line texts */
		foreach ( array(
			'launcher_text', 'title', 'subtitle', 'placeholder', 'send_label', 'agent_label',
			'visitor_label', 'online_text', 'offline_text', 'prechat_title', 'prechat_name_label',
			'prechat_phone_label', 'prechat_button',
		) as $key ) {
			$out[ $key ] = isset( $raw[ $key ] ) ? sanitize_text_field( wp_unslash( $raw[ $key ] ) ) : $d[ $key ];
		}

		/*
		 * The bot identity is filled in automatically by "تست اتصال". An empty
		 * form field must not erase what we already know.
		 */
		foreach ( array( 'bale_bot_username', 'bale_bot_name' ) as $key ) {
			$value       = isset( $raw[ $key ] ) ? sanitize_text_field( wp_unslash( $raw[ $key ] ) ) : '';
			$out[ $key ] = ( '' !== trim( $value ) ) ? trim( $value ) : $old[ $key ];
		}

		/* multi line texts */
		foreach ( array( 'greeting', 'offline_notice', 'closed_notice', 'rate_notice', 'typing_text' ) as $key ) {
			$out[ $key ] = isset( $raw[ $key ] ) ? sanitize_textarea_field( wp_unslash( $raw[ $key ] ) ) : $d[ $key ];
		}

		/* numbers */
		$numbers = array(
			'launcher_offset_x' => array( 0, 400 ),
			'launcher_offset_y' => array( 0, 400 ),
			'launcher_mobile_y' => array( 0, 240 ),
			'auto_open_delay'   => array( 0, 300 ),
			'poll_interval'     => array( 2, 60 ),
			'poll_closed'       => array( 10, 600 ),
			'max_length'        => array( 50, 4000 ),
			'rate_limit'        => array( 1, 120 ),
			'rate_window'       => array( 10, 3600 ),
			'retain_days'       => array( 1, 3650 ),
			'width'             => array( 280, 640 ),
			'height'            => array( 320, 900 ),
			'radius'            => array( 0, 40 ),
		);
		foreach ( $numbers as $key => $range ) {
			$val         = isset( $raw[ $key ] ) ? intval( $raw[ $key ] ) : intval( $d[ $key ] );
			$out[ $key ] = max( $range[0], min( $range[1], $val ) );
		}

		/* enums */
		$out['launcher']          = self::enum( isset( $raw['launcher'] ) ? $raw['launcher'] : $d['launcher'], array( 'item', 'button', 'both' ), $d['launcher'] );
		$out['launcher_position'] = self::enum( isset( $raw['launcher_position'] ) ? $raw['launcher_position'] : $d['launcher_position'], array_keys( self::positions() ), $d['launcher_position'] );
		$out['bale_mode']         = self::enum( isset( $raw['bale_mode'] ) ? $raw['bale_mode'] : $d['bale_mode'], array( 'webhook', 'poll' ), $d['bale_mode'] );

		$icons = array_keys( TMB_Icons::all() );
		$out['launcher_icon'] = self::enum( isset( $raw['launcher_icon'] ) ? $raw['launcher_icon'] : $d['launcher_icon'], $icons, 'chat' );

		/* colors */
		foreach ( array(
			'launcher_color_1', 'launcher_color_2', 'launcher_fg', 'header_bg', 'header_text',
			'panel_bg', 'bubble_visitor', 'bubble_visitor_text', 'bubble_agent', 'bubble_agent_text',
			'accent', 'text_muted',
		) as $key ) {
			$out[ $key ] = isset( $raw[ $key ] ) ? self::sanitize_color( $raw[ $key ], $d[ $key ] ) : $d[ $key ];
		}

		/* business hours */
		$out['hours_days'] = self::sanitize_list(
			isset( $raw['hours_days'] ) ? $raw['hours_days'] : array(),
			array_keys( TMB_Visibility::days() )
		);
		foreach ( array( 'hours_from', 'hours_to' ) as $key ) {
			$val         = isset( $raw[ $key ] ) ? trim( sanitize_text_field( wp_unslash( $raw[ $key ] ) ) ) : '';
			$out[ $key ] = self::valid_time( $val ) ? $val : '';
		}

		/* ---- Bale ---- */
		$token = isset( $raw['bale_token'] ) ? trim( (string) wp_unslash( $raw['bale_token'] ) ) : '';
		$token = preg_replace( '/\s+/', '', $token );

		if ( '' !== $token && ! preg_match( '/^[0-9]{5,20}:[A-Za-z0-9_-]{20,80}$/', $token ) ) {
			// Keep whatever was stored before instead of saving a broken token.
			$token = $old['bale_token'];
		}
		$out['bale_token'] = $token;

		$base = isset( $raw['bale_api_base'] ) ? trim( (string) wp_unslash( $raw['bale_api_base'] ) ) : '';
		$base = esc_url_raw( $base, array( 'https' ) );
		if ( '' === $base || false === strpos( $base, 'https://' ) ) {
			$base = $d['bale_api_base'];
		}
		$out['bale_api_base'] = untrailingslashit( $base );

		$ids   = array();
		$parts = preg_split( '/[\s,;،]+/', (string) ( isset( $raw['bale_chat_ids'] ) ? wp_unslash( $raw['bale_chat_ids'] ) : '' ) );
		foreach ( (array) $parts as $part ) {
			$part = trim( (string) $part );
			if ( '' === $part ) {
				continue;
			}
			// Chat ids are numeric (a leading minus for channels/supergroups),
			// @usernames are accepted too.
			if ( preg_match( '/^-?\d{3,20}$/', $part ) ) {
				$ids[] = $part;
			} elseif ( preg_match( '/^@[A-Za-z0-9_]{4,40}$/', $part ) ) {
				$ids[] = $part;
			}
			if ( count( $ids ) >= 20 ) {
				break;
			}
		}
		$out['bale_chat_ids'] = implode( "\n", array_values( array_unique( $ids ) ) );

		$secret = isset( $raw['bale_secret'] ) ? preg_replace( '/[^A-Za-z0-9]/', '', (string) wp_unslash( $raw['bale_secret'] ) ) : '';
		if ( strlen( $secret ) < 16 ) {
			$secret = preg_replace( '/[^A-Za-z0-9]/', '', (string) $old['bale_secret'] );
		}
		if ( strlen( $secret ) < 16 ) {
			$secret = self::random_secret();
		}
		$out['bale_secret'] = substr( $secret, 0, 64 );

		return $out;
	}

	/**
	 * Whitelist helper for enum values.
	 *
	 * @param mixed  $value    Raw value.
	 * @param array  $allowed  Allowed values.
	 * @param string $fallback Fallback.
	 * @return string
	 */
	protected static function enum( $value, $allowed, $fallback ) {
		$value = sanitize_key( (string) $value );
		return in_array( $value, $allowed, true ) ? $value : $fallback;
	}

	/**
	 * Random URL-safe secret used to protect the Bale webhook.
	 *
	 * @return string
	 */
	public static function random_secret() {
		return substr( md5( wp_generate_password( 32, false, false ) . wp_salt( 'auth' ) . microtime() ), 0, 32 );
	}

	/**
	 * Sanitize one box.
	 *
	 * @param array $raw   Raw box data.
	 * @param int   $index Position in the list (used for the fallback id).
	 * @return array
	 */
	public static function sanitize_box( $raw, $index = 1 ) {
		$d   = self::box_defaults();
		$box = array();

		/* id + name */
		$id         = isset( $raw['id'] ) ? sanitize_key( $raw['id'] ) : '';
		$box['id']  = $id ? $id : 'box' . $index;
		$box['name'] = isset( $raw['name'] ) && '' !== trim( (string) $raw['name'] )
			? sanitize_text_field( wp_unslash( $raw['name'] ) )
			/* translators: %d: box number */
			: sprintf( __( 'باکس %d', 'tamas-box' ), $index );

		/* checkboxes */
		$checks = array(
			'enabled', 'btn_show_text', 'btn_shadow', 'btn_pulse', 'btn_show_tooltip',
			'panel_show_head', 'use_brand_colors', 'show_desktop', 'show_mobile', 'schedule_enabled',
		);
		foreach ( $checks as $key ) {
			$box[ $key ] = ! empty( $raw[ $key ] ) ? 1 : 0;
		}

		/* text */
		foreach ( array( 'btn_text', 'btn_tooltip', 'panel_title', 'panel_subtitle', 'close_text' ) as $key ) {
			$box[ $key ] = isset( $raw[ $key ] ) ? sanitize_text_field( wp_unslash( $raw[ $key ] ) ) : $d[ $key ];
		}

		/* colors */
		$colors = array(
			'btn_color_1', 'btn_color_2', 'btn_icon_color', 'btn_pulse_color',
			'panel_bg', 'panel_text', 'panel_sub_text', 'panel_head_bg', 'panel_head_text',
			'item_bg', 'item_hover_bg', 'item_divider', 'item_text', 'item_sub_text', 'close_color',
		);
		foreach ( $colors as $key ) {
			$box[ $key ] = isset( $raw[ $key ] ) ? self::sanitize_color( $raw[ $key ], $d[ $key ] ) : $d[ $key ];
		}

		/* numbers */
		$numbers = array(
			'offset_x'        => array( 0, 400 ),
			'offset_y'        => array( 0, 400 ),
			'mobile_offset_y' => array( 0, 240 ),
			'btn_size'        => array( 36, 120 ),
			'btn_radius'      => array( 0, 50 ),
			'panel_radius'    => array( 0, 40 ),
			'panel_width'     => array( 240, 560 ),
			'icon_size'       => array( 24, 72 ),
		);
		foreach ( $numbers as $key => $range ) {
			$val         = isset( $raw[ $key ] ) ? intval( $raw[ $key ] ) : intval( $d[ $key ] );
			$box[ $key ] = max( $range[0], min( $range[1], $val ) );
		}

		/* enums */
		$enums = array(
			'position'     => array_keys( self::positions() ),
			'btn_icon'     => array_keys( TMB_Icons::all() ),
			'item_style'   => array( 'row', 'card', 'grid' ),
			'icon_shape'   => array( 'circle', 'rounded', 'square', 'plain' ),
			'animation'    => array( 'slide', 'fade', 'zoom' ),
			'close_style'  => array( 'outline', 'solid', 'icon' ),
			'display_mode' => array( 'all', 'only' ),
			'user_mode'    => array( 'all', 'logged_in', 'logged_out', 'roles' ),
		);
		foreach ( $enums as $key => $allowed ) {
			$val         = isset( $raw[ $key ] ) ? sanitize_key( $raw[ $key ] ) : $d[ $key ];
			$box[ $key ] = in_array( $val, $allowed, true ) ? $val : $d[ $key ];
		}

		/* id lists */
		foreach ( array( 'show_ids', 'hide_ids', 'show_terms', 'hide_terms' ) as $key ) {
			$parts = preg_split( '/[\s,;،]+/', (string) ( isset( $raw[ $key ] ) ? wp_unslash( $raw[ $key ] ) : '' ) );
			$clean = array();
			foreach ( (array) $parts as $p ) {
				$p = absint( $p );
				if ( $p ) {
					$clean[] = $p;
				}
			}
			$box[ $key ] = implode( ',', array_unique( $clean ) );
		}

		/* url rules */
		foreach ( array( 'url_show', 'url_hide' ) as $key ) {
			$lines = preg_split( '/[\r\n]+/', (string) ( isset( $raw[ $key ] ) ? wp_unslash( $raw[ $key ] ) : '' ) );
			$clean = array();
			foreach ( (array) $lines as $line ) {
				$line = sanitize_text_field( $line );
				if ( '' !== $line ) {
					$clean[] = $line;
				}
			}
			$box[ $key ] = implode( "\n", array_slice( array_unique( $clean ), 0, 200 ) );
		}

		/* multi selects */
		$valid_types = array_unique(
			array_merge(
				array_keys( TMB_Visibility::page_types() ),
				array( 'front', 'blog', 'page', 'post', 'singular', 'archive', 'category', 'tag', 'author', 'date', 'search', 'notfound', 'attachment', 'shop', 'product', 'product_cat', 'cart', 'checkout', 'account' )
			)
		);
		foreach ( array( 'show_types', 'hide_types' ) as $key ) {
			$box[ $key ] = self::sanitize_list( isset( $raw[ $key ] ) ? $raw[ $key ] : array(), $valid_types );
		}

		$valid_pts = array_values( get_post_types( array( 'public' => true ), 'names' ) );
		foreach ( array( 'show_post_types', 'hide_post_types' ) as $key ) {
			$box[ $key ] = self::sanitize_list( isset( $raw[ $key ] ) ? $raw[ $key ] : array(), $valid_pts );
		}

		$valid_roles       = function_exists( 'wp_roles' ) ? array_keys( wp_roles()->get_names() ) : array();
		$box['user_roles'] = self::sanitize_list( isset( $raw['user_roles'] ) ? $raw['user_roles'] : array(), $valid_roles );

		/* schedule */
		$box['schedule_days'] = self::sanitize_list(
			isset( $raw['schedule_days'] ) ? $raw['schedule_days'] : array(),
			array_keys( TMB_Visibility::days() )
		);

		foreach ( array( 'schedule_from', 'schedule_to' ) as $key ) {
			$val         = isset( $raw[ $key ] ) ? trim( sanitize_text_field( wp_unslash( $raw[ $key ] ) ) ) : '';
			$box[ $key ] = self::valid_time( $val ) ? $val : '';
		}

		/* extra time ranges */
		$ranges = array();
		if ( ! empty( $raw['schedule_ranges'] ) && is_array( $raw['schedule_ranges'] ) ) {
			foreach ( $raw['schedule_ranges'] as $range ) {
				if ( ! is_array( $range ) ) {
					continue;
				}
				$from = isset( $range['from'] ) ? trim( sanitize_text_field( wp_unslash( $range['from'] ) ) ) : '';
				$to   = isset( $range['to'] ) ? trim( sanitize_text_field( wp_unslash( $range['to'] ) ) ) : '';

				if ( ! self::valid_time( $from ) || ! self::valid_time( $to ) ) {
					continue;
				}

				$days = self::sanitize_list(
					isset( $range['days'] ) ? $range['days'] : array(),
					array_keys( TMB_Visibility::days() )
				);

				$ranges[] = array(
					'days' => $days,
					'from' => $from,
					'to'   => $to,
				);

				if ( count( $ranges ) >= 20 ) {
					break;
				}
			}
		}
		$box['schedule_ranges'] = $ranges;

		/* items */
		$items = array();
		if ( ! empty( $raw['items'] ) && is_array( $raw['items'] ) ) {
			foreach ( $raw['items'] as $item ) {
				if ( ! is_array( $item ) ) {
					continue;
				}
				$label = isset( $item['label'] ) ? sanitize_text_field( wp_unslash( $item['label'] ) ) : '';
				$url   = isset( $item['url'] ) ? trim( wp_unslash( $item['url'] ) ) : '';
				$action = isset( $item['action'] ) ? sanitize_key( $item['action'] ) : 'link';
				$action = in_array( $action, array( 'link', 'chat' ), true ) ? $action : 'link';

				if ( '' === $label && '' === $url && 'chat' !== $action ) {
					continue;
				}

				if ( 'chat' === $action && '' === $label ) {
					$label = __( 'چت آنلاین', 'tamas-box' );
				}

				$icons  = TMB_Icons::all();
				$icon   = isset( $item['icon'] ) ? sanitize_key( $item['icon'] ) : 'link';
				$icon   = isset( $icons[ $icon ] ) ? $icon : ( 'chat' === $action ? 'chat' : 'link' );
				$device = isset( $item['device'] ) ? sanitize_key( $item['device'] ) : 'both';
				$device = in_array( $device, array( 'both', 'desktop', 'mobile' ), true ) ? $device : 'both';

				$items[] = array(
					'enabled'      => ! empty( $item['enabled'] ) ? 1 : 0,
					'action'       => $action,
					'label'        => $label,
					'sublabel'     => isset( $item['sublabel'] ) ? sanitize_text_field( wp_unslash( $item['sublabel'] ) ) : '',
					'icon'         => $icon,
					'url'          => ( 'chat' === $action ) ? '#tmb-chat' : self::sanitize_url( $url ),
					'color'        => isset( $item['color'] ) ? self::sanitize_color( $item['color'], TMB_Icons::color( $icon ) ) : TMB_Icons::color( $icon ),
					'custom_color' => ! empty( $item['custom_color'] ) ? 1 : 0,
					'new_tab'      => ! empty( $item['new_tab'] ) ? 1 : 0,
					'nofollow'     => ! empty( $item['nofollow'] ) ? 1 : 0,
					'device'       => $device,
				);
			}
		}
		$box['items'] = $items;

		return $box;
	}

	/**
	 * HH:MM validator.
	 *
	 * @param string $val Time.
	 * @return bool
	 */
	public static function valid_time( $val ) {
		return (bool) preg_match( '/^([01]\d|2[0-3]):([0-5]\d)$/', (string) $val );
	}

	/**
	 * Keep only values present in a whitelist.
	 *
	 * @param mixed $value   Raw value.
	 * @param array $allowed Allowed keys.
	 * @return array
	 */
	public static function sanitize_list( $value, $allowed ) {
		if ( ! is_array( $value ) ) {
			$value = array( $value );
		}

		$out = array();
		foreach ( $value as $v ) {
			$v = sanitize_key( $v );
			if ( '' !== $v && in_array( $v, $allowed, true ) ) {
				$out[] = $v;
			}
		}

		return array_values( array_unique( $out ) );
	}

	/**
	 * Allow hex + rgba colors.
	 *
	 * @param string $color    Color value.
	 * @param string $fallback Fallback.
	 * @return string
	 */
	public static function sanitize_color( $color, $fallback = '' ) {
		$color = trim( (string) wp_unslash( $color ) );

		if ( '' === $color ) {
			return $fallback;
		}
		$hex = sanitize_hex_color( $color );
		if ( $hex ) {
			return $hex;
		}
		if ( preg_match( '/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i', $color ) ) {
			return $color;
		}
		if ( 'transparent' === strtolower( $color ) ) {
			return 'transparent';
		}
		return $fallback;
	}

	/**
	 * Sanitize a link supporting tel:, sms:, mailto:, whatsapp:, http(s) and anchors.
	 *
	 * @param string $url Raw url.
	 * @return string
	 */
	public static function sanitize_url( $url ) {
		$url = trim( (string) $url );
		if ( '' === $url ) {
			return '';
		}
		if ( 0 === strpos( $url, '#' ) ) {
			return sanitize_text_field( $url );
		}
		if ( preg_match( '/^(tel|sms|mailto|whatsapp|skype|viber|callto|intent|geo):/i', $url ) ) {
			return esc_url_raw( $url, array( 'tel', 'sms', 'mailto', 'whatsapp', 'skype', 'viber', 'callto', 'intent', 'geo', 'http', 'https' ) );
		}
		if ( ! preg_match( '#^https?://#i', $url ) && false !== strpos( $url, '.' ) && 0 !== strpos( $url, '/' ) ) {
			$url = 'https://' . $url;
		}
		return esc_url_raw( $url );
	}
}
