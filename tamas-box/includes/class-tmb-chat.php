<?php
/**
 * Live chat controller.
 *
 * Public REST API used by the chat widget, the Bale webhook, the WP-Cron
 * fallback poller and the dashboard inbox.
 *
 * @package Tamas_Box
 * @since   3.2.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TMB_Chat {

	const REST_NAMESPACE = 'tmb/v1';

	const CRON_HOOK = 'tmb_chat_cron';

	/**
	 * Singleton.
	 *
	 * @var TMB_Chat|null
	 */
	protected static $instance = null;

	/**
	 * Cached chat settings for this request.
	 *
	 * @var array|null
	 */
	protected static $cfg = null;

	/**
	 * Instance accessor.
	 *
	 * @return TMB_Chat
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Hooks.
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'assets' ), 20 );
		/*
		 * Priority 5 on purpose: WordPress prints footer scripts on wp_footer at
		 * priority 20, and chat.js needs #tmbc-root to exist when it runs.
		 */
		add_action( 'wp_footer', array( $this, 'render' ), 5 );
		add_action( 'init', array( $this, 'cron_setup' ) );
		add_action( 'template_redirect', array( $this, 'maybe_report' ), 0 );
		add_action( 'init', array( $this, 'self_heal' ), 6 );
		add_action( self::CRON_HOOK, array( $this, 'cron_tick' ) );
		add_filter( 'cron_schedules', array( $this, 'cron_interval' ) );

		add_shortcode( 'tamas_chat', array( $this, 'shortcode' ) );
	}

	/* ---------------------------------------------------------------------
	 * Settings helpers
	 * ------------------------------------------------------------------ */

	/**
	 * Chat settings (cached per request).
	 *
	 * @return array
	 */
	public static function cfg() {
		if ( null === self::$cfg ) {
			self::$cfg = TMB_Settings::chat();
		}
		return self::$cfg;
	}

	/**
	 * Forget the cached chat settings (after they were changed in code,
	 * for example when the Bale join link registers a new admin chat).
	 *
	 * @return void
	 */
	public static function reset_cfg_cache() {
		self::$cfg = null;
	}

	/**
	 * Is the chat module switched on?
	 *
	 * @return bool
	 */
	public static function enabled() {
		$s = TMB_Settings::get();

		if ( empty( $s['enabled'] ) || empty( $s['chat']['enabled'] ) ) {
			return false;
		}

		/**
		 * Final word for developers.
		 *
		 * @param bool  $enabled
		 * @param array $chat Chat settings.
		 */
		return (bool) apply_filters( 'tmb_chat_enabled', true, $s['chat'] );
	}

	/**
	 * Is the support desk "online" right now (business hours)?
	 *
	 * @return bool
	 */
	public static function is_online() {
		$c = self::cfg();

		if ( empty( $c['hours_enabled'] ) ) {
			return true;
		}

		$days = (array) $c['hours_days'];
		$from = trim( (string) $c['hours_from'] );
		$to   = trim( (string) $c['hours_to'] );

		// "Working hours" is on but nothing is limited yet -> always online.
		if ( empty( $days ) && '' === $from && '' === $to ) {
			return true;
		}

		$today = strtolower( current_time( 'D' ) );
		$now   = (int) current_time( 'Hi' );

		return TMB_Visibility::range_matches(
			array(
				'days' => $days,
				'from' => $from,
				'to'   => $to,
			),
			$today,
			$now
		);
	}

	/* ---------------------------------------------------------------------
	 * Rendering
	 * ------------------------------------------------------------------ */

	/**
	 * Does any visible contact box contain a "chat" item?
	 *
	 * @return bool
	 */
	public static function boxes_need_chat() {
		if ( ! self::enabled() ) {
			return false;
		}

		$boxes = class_exists( 'TMB_Frontend' ) ? TMB_Frontend::visible_boxes() : array();

		foreach ( (array) $boxes as $box ) {
			if ( empty( $box['items'] ) ) {
				continue;
			}
			foreach ( (array) $box['items'] as $item ) {
				if ( ! empty( $item['enabled'] ) && isset( $item['action'] ) && 'chat' === $item['action'] ) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Should the widget markup be printed on this page?
	 *
	 * @return bool
	 */
	public function should_render() {
		if ( ! self::enabled() || is_admin() ) {
			return false;
		}

		$c = self::cfg();

		if ( ! empty( $c['require_login'] ) && ! is_user_logged_in() ) {
			return false;
		}

		/*
		 * The widget is printed on every front end page while the module is on.
		 * Gating it on "does a visible box contain a chat item" looked clever
		 * but produced dead buttons: a box placed with the [tamas_box]
		 * shortcode (or by a filter) shows the item while the widget itself
		 * was never printed. Chat items, the launcher and TamasBoxChat.open()
		 * now always have a window to open.
		 */
		return TMB_Visibility::is_active( TMB_Settings::get() );
	}

	/**
	 * Enqueue the widget assets.
	 *
	 * @return void
	 */
	public function assets() {
		if ( ! $this->should_render() ) {
			return;
		}

		$this->enqueue_assets();
	}

	/**
	 * Enqueue (safe to call more than once, e.g. from a shortcode).
	 *
	 * @return void
	 */
	public function enqueue_assets() {
		if ( ! self::enabled() ) {
			return;
		}

		wp_enqueue_style( 'tmb-chat', TMB_URL . 'assets/css/chat.css', array(), TMB_VERSION );
		wp_add_inline_style( 'tmb-chat', $this->inline_css() );

		wp_enqueue_script( 'tmb-chat', TMB_URL . 'assets/js/chat.js', array(), TMB_VERSION, true );
		wp_localize_script( 'tmb-chat', 'TMB_CHAT', $this->frontend_config() );
	}

	/**
	 * Everything the widget script needs.
	 *
	 * Remember: wp_localize_script turns every scalar into a string, so the
	 * script normalises "0"/"1" and numbers itself.
	 *
	 * @return array
	 */
	public function frontend_config() {
		$c = self::cfg();

		$config = array(
			'rest'        => esc_url_raw( rest_url( self::REST_NAMESPACE . '/chat' ) ),
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'home'        => esc_url_raw( home_url( '/' ) ),
			'page'        => esc_url_raw( $this->current_page_url() ),
			'loggedIn'    => is_user_logged_in() ? 1 : 0,
			'userName'    => is_user_logged_in() ? wp_get_current_user()->display_name : '',
			'online'      => self::is_online() ? 1 : 0,
			'version'     => TMB_VERSION,

			'enabled'     => 1,
			'launcher'    => $c['launcher'],
			'badge'       => (int) $c['badge'],
			'sound'       => (int) $c['sound'],
			'autoOpen'    => (int) $c['auto_open'],
			'autoDelay'   => (int) $c['auto_open_delay'],
			'poll'        => (int) $c['poll_interval'],
			'pollClosed'  => (int) $c['poll_closed'],
			'maxLength'   => (int) $c['max_length'],
			'allowNew'    => (int) $c['allow_new_chat'],
			'poweredBy'   => (int) $c['powered_by'],

			'title'       => $c['title'],
			'subtitle'    => $c['subtitle'],
			'greeting'    => $c['greeting'],
			'placeholder' => $c['placeholder'],
			'sendLabel'   => $c['send_label'],
			'agentLabel'  => $c['agent_label'],
			'visitorLabel'=> $c['visitor_label'],
			'onlineText'  => $c['online_text'],
			'offlineText' => $c['offline_text'],
			'offlineNote' => $c['offline_notice'],
			'closedNote'  => $c['closed_notice'],
			'rateNote'    => $c['rate_notice'],
			'typingText'  => $c['typing_text'],

			'prechat'     => array(
				'enabled'  => (int) $c['prechat_enabled'],
				'name'     => (int) $c['prechat_name'],
				'phone'    => (int) $c['prechat_phone'],
				'required' => (int) $c['prechat_required'],
				'title'    => $c['prechat_title'],
				'nameLabel'=> $c['prechat_name_label'],
				'phoneLabel' => $c['prechat_phone_label'],
				'button'   => $c['prechat_button'],
			),

			'i18n'        => array(
				'open'        => __( 'باز کردن چت', 'tamas-box' ),
				'close'       => __( 'بستن', 'tamas-box' ),
				'minimize'    => __( 'کوچک کردن', 'tamas-box' ),
				'newChat'     => __( 'گفتگوی جدید', 'tamas-box' ),
				'sending'     => __( 'در حال ارسال…', 'tamas-box' ),
				'failed'      => __( 'ارسال ناموفق بود. دوباره تلاش کنید.', 'tamas-box' ),
				'empty'       => __( 'متن پیام خالی است.', 'tamas-box' ),
				'tooLong'     => __( 'پیام خیلی طولانی است.', 'tamas-box' ),
				'unread'      => __( 'پیام جدید', 'tamas-box' ),
				'closed'      => __( 'بسته شده', 'tamas-box' ),
				'offline'     => __( 'آفلاین', 'tamas-box' ),
				'retry'       => __( 'تلاش دوباره', 'tamas-box' ),
				'voiceNote'   => __( 'پیام صوتی', 'tamas-box' ),
				'download'    => __( 'دانلود', 'tamas-box' ),
				'prechatSkip' => __( 'رد کردن', 'tamas-box' ),
			),
		);

		/**
		 * Filter the data handed to the chat widget.
		 *
		 * @param array $config
		 */
		return apply_filters( 'tmb_chat_frontend_config', $config );
	}

	/**
	 * CSS variables of the widget.
	 *
	 * @return string
	 */
	public function inline_css() {
		$c = self::cfg();

		$css  = '.tmbc-root{';
		$css .= '--tmbc-accent:' . $c['accent'] . ';';
		$css .= '--tmbc-head-bg:' . $c['header_bg'] . ';';
		$css .= '--tmbc-head-fg:' . $c['header_text'] . ';';
		$css .= '--tmbc-panel-bg:' . $c['panel_bg'] . ';';
		$css .= '--tmbc-me-bg:' . $c['bubble_visitor'] . ';';
		$css .= '--tmbc-me-fg:' . $c['bubble_visitor_text'] . ';';
		$css .= '--tmbc-they-bg:' . $c['bubble_agent'] . ';';
		$css .= '--tmbc-they-fg:' . $c['bubble_agent_text'] . ';';
		$css .= '--tmbc-muted:' . $c['text_muted'] . ';';
		$css .= '--tmbc-w:' . intval( $c['width'] ) . 'px;';
		$css .= '--tmbc-h:' . intval( $c['height'] ) . 'px;';
		$css .= '--tmbc-radius:' . intval( $c['radius'] ) . 'px;';
		$css .= '--tmbc-btn-1:' . $c['launcher_color_1'] . ';';
		$css .= '--tmbc-btn-2:' . ( $c['launcher_color_2'] ? $c['launcher_color_2'] : $c['launcher_color_1'] ) . ';';
		$css .= '--tmbc-btn-fg:' . $c['launcher_fg'] . ';';
		$css .= '--tmbc-x:' . intval( $c['launcher_offset_x'] ) . 'px;';
		$css .= '--tmbc-y:' . intval( $c['launcher_offset_y'] ) . 'px;';
		$css .= '--tmbc-y-mobile:' . intval( $c['launcher_mobile_y'] ) . 'px;';
		$css .= '}';

		$pos = $c['launcher_position'];
		if ( in_array( $pos, array_keys( TMB_Settings::positions() ), true ) ) {
			$css .= '.tmbc-root{--tmbc-pos:' . $pos . ';}';
		}

		return $css;
	}

	/**
	 * Print the widget markup in the footer.
	 *
	 * @return void
	 */
	public function render() {
		if ( ! $this->should_render() ) {
			return;
		}

		if ( $this->rendered ) {
			return;
		}
		$this->rendered = true;

		$this->enqueue_assets();

		echo $this->widget_markup(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped

		if ( isset( $_GET['tmb_selftest'] ) ) {
			echo $this->selftest_markup(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		}
	}

	/**
	 * Browser side self test, printed only on ?tmb_selftest=1.
	 *
	 * Opens the chat exactly like a visitor click would, measures what the
	 * browser ends up with (classes, computed css, bounding box, js errors) and
	 * posts it back to /chat/selftest, where the diagnostics report picks it up.
	 *
	 * @return string
	 */
	protected function selftest_markup() {
		$rest = esc_url_raw( rest_url( self::REST_NAMESPACE . '/chat' ) );
		$ver  = TMB_VERSION;

		return '<script id="tmbc-selftest">
( function () {
	var REST = ' . wp_json_encode( $rest ) . ';
	var errs = [];

	window.addEventListener( "error", function ( e ) {
		errs.push( String( e.message || e ) + " @" + String( e.filename || "" ).split( "/" ).pop() + ":" + e.lineno );
	} );
	window.addEventListener( "unhandledrejection", function ( e ) {
		var r = e && e.reason;
		errs.push( "promise: " + String( ( r && r.message ) || r ) );
	} );

	function send( payload ) {
		try {
			var x = new XMLHttpRequest();
			x.open( "POST", REST + "/selftest", true );
			x.setRequestHeader( "Content-Type", "application/json" );
			x.withCredentials = true;
			x.send( JSON.stringify( payload ) );
		} catch ( e ) {}
	}

	function run() {
		var root = document.getElementById( "tmbc-root" );
		var api = window.TamasBoxChat;
		var p = {
			v: ' . wp_json_encode( $ver ) . ',
			href: String( location.href ).slice( 0, 200 ),
			ua: String( navigator.userAgent ).slice( 0, 220 ),
			root: !! root,
			rootClass: root ? String( root.className ) : "",
			api: !! api,
			inlineCfg: !! ( window.TMB_CHAT && window.TMB_CHAT.rest ),
			attrCfg: !! ( root && root.getAttribute( "data-tmbc-config" ) ),
			bootError: String( window.TMB_CHAT_ERROR || "" ).slice( 0, 500 ),
			bodyState: document.body ? String( document.body.getAttribute( "data-tmbc-state" ) || "" ) : "",
			jq: !! window.jQuery,
			errors: errs.slice( 0, 6 )
		};

		if ( ! api ) {
			send( p );
			return;
		}

		var probe = document.createElement( "a" );
		probe.setAttribute( "href", "#tmb-chat" );
		probe.setAttribute( "data-tmb-action", "chat" );
		probe.style.display = "none";
		document.body.appendChild( probe );

		var ev;
		try {
			ev = new MouseEvent( "click", { bubbles: true, cancelable: true } );
		} catch ( e ) {
			ev = document.createEvent( "MouseEvents" );
			ev.initEvent( "click", true, true );
		}
		probe.dispatchEvent( ev );
		p.prevented = !! ev.defaultPrevented;

		window.setTimeout( function () {
			var panel = document.getElementById( "tmbc-panel" );

			p.opened = !! ( root && root.classList.contains( "is-open" ) );
			p.panelFound = !! panel;
			p.panelHidden = panel ? !! panel.hidden : null;

			if ( panel ) {
				var cs = window.getComputedStyle( panel );
				var r = panel.getBoundingClientRect();
				p.panelCss = cs.display + "/" + cs.visibility + "/" + cs.opacity + "/z=" + cs.zIndex;
				p.panelBox = Math.round( r.width ) + "x" + Math.round( r.height ) + "@" + Math.round( r.left ) + "," + Math.round( r.top );
			}
			if ( root ) {
				var rs = window.getComputedStyle( root );
				var rr = root.getBoundingClientRect();
				p.rootCss = rs.display + "/z=" + rs.zIndex;
				p.rootBox = Math.round( rr.width ) + "x" + Math.round( rr.height ) + "@" + Math.round( rr.left ) + "," + Math.round( rr.top );
				p.rootClassAfter = String( root.className );
			}

			try { api.close(); } catch ( e ) {}
			if ( probe.parentNode ) { probe.parentNode.removeChild( probe ); }

			send( p );
		}, 3000 );
	}

	if ( "complete" === document.readyState ) {
		window.setTimeout( run, 1000 );
	} else {
		window.addEventListener( "load", function () {
			window.setTimeout( run, 1000 );
		} );
	}
} )();
</script>';
	}

	/**
	 * Rendered once per request.
	 *
	 * @var bool
	 */
	protected $rendered = false;

	/**
	 * Widget markup.
	 *
	 * @return string
	 */
	public function widget_markup() {
		$c    = self::cfg();
		$s    = TMB_Settings::get();
		$dir  = 'auto' === $s['direction'] ? ( is_rtl() ? 'rtl' : 'ltr' ) : $s['direction'];
		$show_launcher = in_array( $c['launcher'], array( 'button', 'both' ), true );

		/*
		 * The widget config travels twice: as an inline script (wp_localize_script)
		 * and as an attribute on the root element. Page caches and js optimisers
		 * happily move, defer or drop inline scripts - the attribute survives and
		 * chat.js falls back to it, so the button never dies silently.
		 */
		$config    = $this->frontend_config();
		$rest_url  = isset( $config['rest'] ) ? $config['rest'] : '';
		$nonce     = isset( $config['nonce'] ) ? $config['nonce'] : '';
		$cfg_json  = (string) wp_json_encode( $config );

		ob_start();
		?>
		<div class="tmbc-root tmbc-pos-<?php echo esc_attr( $c['launcher_position'] ); ?>" id="tmbc-root" dir="<?php echo esc_attr( $dir ); ?>"
			data-tmbc="<?php echo esc_attr( $show_launcher ? 'launcher' : 'panel' ); ?>"
			data-tmbc-rest="<?php echo esc_attr( esc_url_raw( $rest_url ) ); ?>"
			data-tmbc-nonce="<?php echo esc_attr( $nonce ); ?>"
			data-tmbc-config="<?php echo esc_attr( $cfg_json ); ?>">

			<div class="tmbc-overlay" data-tmbc-overlay hidden></div>

			<div class="tmbc-panel" id="tmbc-panel" role="dialog" aria-label="<?php echo esc_attr( $c['title'] ); ?>" aria-live="polite" hidden>

				<div class="tmbc-head">
					<span class="tmbc-avatar" aria-hidden="true">
						<?php echo TMB_Icons::svg( $c['launcher_icon'], 'tmb-ico' ); // phpcs:ignore ?>
					</span>
					<span class="tmbc-head-texts">
						<strong class="tmbc-title"><?php echo esc_html( $c['title'] ); ?></strong>
						<span class="tmbc-status" data-tmbc-status>
							<i class="tmbc-dot"></i>
							<span data-tmbc-status-text><?php echo esc_html( self::is_online() ? $c['online_text'] : $c['offline_text'] ); ?></span>
						</span>
					</span>
					<span class="tmbc-head-actions">
						<button type="button" class="tmbc-icon-btn" data-tmbc-new hidden title="<?php esc_attr_e( 'گفتگوی جدید', 'tamas-box' ); ?>">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
						</button>
						<button type="button" class="tmbc-icon-btn" data-tmbc-close aria-label="<?php esc_attr_e( 'بستن', 'tamas-box' ); ?>">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
						</button>
					</span>
				</div>

				<div class="tmbc-body" data-tmbc-body role="log" aria-relevant="additions" tabindex="0">
					<div class="tmbc-empty" data-tmbc-empty>
						<span class="tmbc-empty-ico" aria-hidden="true"><?php echo TMB_Icons::svg( 'chat', 'tmb-ico' ); // phpcs:ignore ?></span>
						<p><?php echo esc_html( $c['greeting'] ? $c['greeting'] : $c['subtitle'] ); ?></p>
					</div>
					<div class="tmbc-messages" data-tmbc-messages></div>
					<div class="tmbc-typing" data-tmbc-typing hidden>
						<span class="tmbc-typing-dots"><i></i><i></i><i></i></span>
						<span><?php echo esc_html( $c['typing_text'] ); ?></span>
					</div>
				</div>

				<form class="tmbc-prechat" data-tmbc-prechat hidden>
					<p class="tmbc-prechat-title"><?php echo esc_html( $c['prechat_title'] ); ?></p>
					<?php if ( ! empty( $c['prechat_name'] ) ) : ?>
						<label class="tmbc-field">
							<span><?php echo esc_html( $c['prechat_name_label'] ); ?></span>
							<input type="text" name="name" autocomplete="name" maxlength="120" value="">
						</label>
					<?php endif; ?>
					<?php if ( ! empty( $c['prechat_phone'] ) ) : ?>
						<label class="tmbc-field">
							<span><?php echo esc_html( $c['prechat_phone_label'] ); ?></span>
							<input type="tel" name="contact" autocomplete="tel" maxlength="60" value="" dir="ltr">
						</label>
					<?php endif; ?>
					<div class="tmbc-prechat-actions">
						<button type="submit" class="tmbc-btn-primary"><?php echo esc_html( $c['prechat_button'] ); ?></button>
						<?php if ( empty( $c['prechat_required'] ) ) : ?>
							<button type="button" class="tmbc-btn-ghost" data-tmbc-skip><?php esc_html_e( 'رد کردن', 'tamas-box' ); ?></button>
						<?php endif; ?>
					</div>
				</form>

				<form class="tmbc-composer" data-tmbc-composer>
					<label class="tmbc-composer-label" for="tmbc-input"><?php echo esc_html( $c['placeholder'] ); ?></label>
					<textarea id="tmbc-input" data-tmbc-input rows="1" maxlength="<?php echo esc_attr( intval( $c['max_length'] ) ); ?>"
						placeholder="<?php echo esc_attr( $c['placeholder'] ); ?>"></textarea>
					<button type="submit" class="tmbc-send" data-tmbc-send aria-label="<?php echo esc_attr( $c['send_label'] ); ?>">
						<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z"/></svg>
					</button>
				</form>

				<?php if ( ! empty( $c['powered_by'] ) ) : ?>
					<div class="tmbc-foot">
						<span><?php esc_html_e( 'گفتگوی آنلاین سایت', 'tamas-box' ); ?></span>
					</div>
				<?php endif; ?>
			</div>

			<?php if ( $show_launcher ) : ?>
				<button type="button" class="tmbc-launcher<?php echo empty( $c['launcher_pulse'] ) ? '' : ' tmbc-pulse'; ?>" data-tmbc-toggle
					aria-expanded="false" aria-controls="tmbc-panel" aria-label="<?php echo esc_attr( $c['title'] ); ?>">
					<span class="tmbc-launcher-ico"><?php echo TMB_Icons::svg( $c['launcher_icon'], 'tmb-ico' ); // phpcs:ignore ?></span>
					<span class="tmbc-launcher-x" aria-hidden="true">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
					</span>
					<?php if ( ! empty( $c['launcher_show_text'] ) && '' !== $c['launcher_text'] ) : ?>
						<span class="tmbc-launcher-text"><?php echo esc_html( $c['launcher_text'] ); ?></span>
					<?php endif; ?>
					<span class="tmbc-badge" data-tmbc-badge hidden>0</span>
				</button>
			<?php endif; ?>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Shortcode: a button that opens the chat widget.
	 *
	 * @param array $atts Attributes.
	 * @return string
	 */
	public function shortcode( $atts ) {
		$atts = shortcode_atts(
			array(
				'text' => '',
				'icon' => '',
			),
			$atts,
			'tamas_chat'
		);

		if ( ! self::enabled() ) {
			return '';
		}

		$this->enqueue_assets();

		$c    = self::cfg();
		$text = $atts['text'] ? $atts['text'] : ( $c['launcher_text'] ? $c['launcher_text'] : $c['title'] );
		$icon = $atts['icon'] ? sanitize_key( $atts['icon'] ) : $c['launcher_icon'];

		$html  = '<button type="button" class="tmb-inline-btn tmbc-open-btn" data-tmbc-toggle>';
		$html .= TMB_Icons::svg( $icon, 'tmb-ico' );
		$html .= '<span>' . esc_html( $text ) . '</span>';
		$html .= '<span class="tmbc-badge" data-tmbc-badge hidden>0</span>';
		$html .= '</button>';

		if ( ! $this->rendered ) {
			add_action( 'wp_footer', array( $this, 'render' ), 5 );
		}

		return $html;
	}

	/**
	 * Absolute url of the current page (used as conversation context).
	 *
	 * @return string
	 */
	public function current_page_url() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput

		if ( '' === $uri ) {
			return home_url( '/' );
		}

		return home_url( $uri );
	}

	/* ---------------------------------------------------------------------
	 * REST API
	 * ------------------------------------------------------------------ */

	/**
	 * Register every chat route.
	 *
	 * @return void
	 */
	public function register_routes() {
		$ns = self::REST_NAMESPACE;

		register_rest_route(
			$ns,
			'/chat/session',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_session' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			$ns,
			'/chat/selftest',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_selftest' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			$ns,
			'/chat/message',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_send' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			$ns,
			'/chat/messages',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'rest_poll' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			$ns,
			'/chat/read',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_read' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			$ns,
			'/chat/close',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_close' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			$ns,
			'/chat/restart',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_restart' ),
				'permission_callback' => '__return_true',
			)
		);

		register_rest_route(
			$ns,
			'/chat/bale/(?P<secret>[A-Za-z0-9]{8,64})',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_webhook' ),
				'permission_callback' => '__return_true',
			)
		);

		/* ---- dashboard inbox ---- */
		register_rest_route(
			$ns,
			'/chat/admin/sessions',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'rest_admin_sessions' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);

		register_rest_route(
			$ns,
			'/chat/admin/session/(?P<id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'rest_admin_session' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);

		register_rest_route(
			$ns,
			'/chat/admin/message',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_admin_message' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);

		register_rest_route(
			$ns,
			'/chat/admin/status',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_admin_status' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);

		register_rest_route(
			$ns,
			'/chat/admin/delete',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_admin_delete' ),
				'permission_callback' => array( $this, 'can_manage' ),
			)
		);
	}

	/**
	 * Capability check for dashboard routes.
	 *
	 * @return bool
	 */
	public function can_manage() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Error helper.
	 *
	 * @param string $code    Error code.
	 * @param string $message Message.
	 * @param int    $status  HTTP status.
	 * @param array  $data    Extra data.
	 * @return WP_Error
	 */
	protected function error( $code, $message, $status = 400, $data = array() ) {
		return new WP_Error( $code, $message, array_merge( array( 'status' => $status ), $data ) );
	}

	/**
	 * Make sure the request really comes from this site.
	 *
	 * @param bool $strict Also reject requests with no Origin/Referer header.
	 * @return bool
	 */
	protected function origin_ok( $strict = false ) {
		/**
		 * Allow hosts with exotic proxy setups to relax this check.
		 *
		 * @param bool|null $decision Null = run the normal checks.
		 */
		$forced = apply_filters( 'tmb_chat_origin_check', null );
		if ( null !== $forced ) {
			return (bool) $forced;
		}

		$home = wp_parse_url( home_url() );
		$host = isset( $home['host'] ) ? strtolower( $home['host'] ) : '';

		$candidates = array();

		if ( ! empty( $_SERVER['HTTP_ORIGIN'] ) ) {
			$candidates[] = sanitize_text_field( wp_unslash( $_SERVER['HTTP_ORIGIN'] ) );
		}
		if ( ! empty( $_SERVER['HTTP_REFERER'] ) ) {
			$candidates[] = sanitize_text_field( wp_unslash( $_SERVER['HTTP_REFERER'] ) );
		}

		foreach ( $candidates as $candidate ) {
			$parts    = wp_parse_url( $candidate );
			$chost    = isset( $parts['host'] ) ? strtolower( $parts['host'] ) : '';
			if ( $chost && $chost === $host ) {
				return true;
			}
			if ( $chost && $chost !== $host ) {
				return false;
			}
		}

		return $strict ? false : true;
	}

	/**
	 * Best effort client IP.
	 *
	 * @return string
	 */
	public static function client_ip() {
		$keys = array( 'HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR' );

		foreach ( $keys as $key ) {
			if ( empty( $_SERVER[ $key ] ) ) {
				continue;
			}

			$value = sanitize_text_field( wp_unslash( $_SERVER[ $key ] ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			$first = explode( ',', $value );
			$ip    = trim( (string) $first[0] );

			if ( filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ) {
				/**
				 * @param string $ip
				 */
				return apply_filters( 'tmb_chat_client_ip', $ip );
			}
			if ( filter_var( $ip, FILTER_VALIDATE_IP ) && 'REMOTE_ADDR' === $key ) {
				return apply_filters( 'tmb_chat_client_ip', $ip );
			}
		}

		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput

		return apply_filters( 'tmb_chat_client_ip', $ip );
	}

	/**
	 * Simple per-IP throttle.
	 *
	 * @param string $bucket Name of the bucket.
	 * @param int    $limit  Max hits.
	 * @param int    $window Seconds.
	 * @return int Remaining seconds (0 = allowed).
	 */
	protected function throttle( $bucket, $limit, $window ) {
		$ip    = self::client_ip();
		$key   = 'tmb_chat_' . $bucket . '_' . md5( $ip );
		$hits  = (int) get_transient( $key );

		if ( $hits >= $limit ) {
			return max( 5, $window );
		}

		set_transient( $key, $hits + 1, $window );

		return 0;
	}

	/**
	 * Clean and shorten a chat message.
	 *
	 * @param string $text Raw text.
	 * @param int    $max  Max characters.
	 * @return string
	 */
	public static function sanitize_message( $text, $max = 1000 ) {
		$text = (string) $text;
		$text = wp_kses_no_null( $text, array( 'slash_zero' => 'keep' ) );
		$text = sanitize_textarea_field( $text );
		$text = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text );
		$text = trim( (string) $text );

		$max = max( 20, (int) $max );

		if ( function_exists( 'mb_substr' ) ) {
			if ( mb_strlen( $text, 'UTF-8' ) > $max ) {
				$text = mb_substr( $text, 0, $max, 'UTF-8' );
			}
		} elseif ( strlen( $text ) > $max ) {
			$text = substr( $text, 0, $max );
		}

		return $text;
	}

	/* ---- visitors ---- */

	/**
	 * POST /chat/session - open (or resume) a conversation.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_session( $request ) {
		if ( ! self::enabled() ) {
			return $this->error( 'tmb_chat_off', __( 'چت آنلاین غیرفعال است.', 'tamas-box' ), 403 );
		}

		$c = self::cfg();

		if ( ! empty( $c['require_login'] ) && ! is_user_logged_in() ) {
			return $this->error( 'tmb_login_required', __( 'برای چت باید وارد حساب کاربری خود شوید.', 'tamas-box' ), 401 );
		}

		if ( ! $this->origin_ok( true ) ) {
			return $this->error( 'tmb_bad_origin', __( 'درخواست معتبر نیست.', 'tamas-box' ), 403 );
		}

		$token = TMB_Chat_DB::clean_token( (string) $request->get_param( 'token' ) );

		$name    = self::sanitize_message( (string) $request->get_param( 'name' ), 120 );
		$contact = self::sanitize_message( (string) $request->get_param( 'contact' ), 160 );
		$page    = esc_url_raw( (string) $request->get_param( 'page' ) );

		$session = $token ? TMB_Chat_DB::get_session_by_token( $token ) : null;

		if ( ! $session ) {
			$retry = $this->throttle( 'sessions', 30, HOUR_IN_SECONDS );
			if ( $retry ) {
				return $this->error( 'tmb_rate', $c['rate_notice'], 429, array( 'retry_after' => $retry ) );
			}

			$session = $this->create_session(
				array(
					'name'     => $name,
					'contact'  => $contact,
					'page_url' => $this->safe_page_url( $page ),
				)
			);

			if ( ! $session ) {
				return $this->error( 'tmb_session_failed', __( 'ساخت گفتگو ناموفق بود.', 'tamas-box' ), 500 );
			}
		} else {
			$update = array();

			if ( '' !== $name && $name !== $session['name'] ) {
				$update['name'] = $name;
			}
			if ( '' !== $contact && $contact !== $session['contact'] ) {
				$update['contact'] = $contact;
			}
			$page_url = $this->safe_page_url( $page );
			if ( $page_url && $page_url !== $session['page_url'] ) {
				$update['page_url'] = $page_url;
			}

			if ( $update ) {
				TMB_Chat_DB::update_session( (int) $session['id'], $update );
				$session = array_merge( $session, $update );
			}
		}

		TMB_Chat_DB::mark_read( (int) $session['id'], 'visitor' );

		$messages = TMB_Chat_DB::last_messages( (int) $session['id'], 60 );
		$out      = array();
		foreach ( $messages as $row ) {
			$out[] = $this->message_to_array( $row );
		}

		return rest_ensure_response(
			array(
				'ok'       => true,
				'token'    => $session['token'],
				'session'  => $this->session_to_array( $session ),
				'messages' => $out,
				'config'   => $this->frontend_config(),
			)
		);
	}

	/**
	 * Keep only urls that point at this site.
	 *
	 * @param string $page Raw url.
	 * @return string
	 */
	protected function safe_page_url( $page ) {
		$page = trim( (string) $page );

		if ( '' === $page ) {
			return '';
		}

		$home  = wp_parse_url( home_url() );
		$parts = wp_parse_url( $page );

		if ( empty( $parts['host'] ) || empty( $home['host'] ) ) {
			return '';
		}

		if ( 0 !== strcasecmp( $parts['host'], $home['host'] ) ) {
			return '';
		}

		return esc_url_raw( $page );
	}

	/**
	 * Create a brand new session row.
	 *
	 * @param array $data Optional name/contact/page.
	 * @return array|null Session row.
	 */
	protected function create_session( $data = array() ) {
		$c = self::cfg();

		$token = '';
		for ( $i = 0; $i < 4; $i++ ) {
			$candidate = TMB_Chat_DB::new_token();
			if ( ! TMB_Chat_DB::get_session_by_token( $candidate ) ) {
				$token = $candidate;
				break;
			}
		}

		if ( '' === $token ) {
			return null;
		}

		$user_id = get_current_user_id();
		$name    = isset( $data['name'] ) ? $data['name'] : '';

		if ( '' === $name && $user_id ) {
			$user = wp_get_current_user();
			$name = $user ? $user->display_name : '';
		}

		$page_url = isset( $data['page_url'] ) && $data['page_url'] ? $data['page_url'] : $this->current_page_url();

		$id = TMB_Chat_DB::create_session(
			array(
				'token'    => $token,
				'user_id'  => $user_id,
				'name'     => $name,
				'contact'  => isset( $data['contact'] ) ? $data['contact'] : '',
				'status'   => 'open',
				'page_url' => $page_url,
				'referrer' => isset( $_SERVER['HTTP_REFERER'] ) ? esc_url_raw( wp_unslash( $_SERVER['HTTP_REFERER'] ) ) : '', // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
				'ip'       => apply_filters( 'tmb_chat_store_ip', true ) ? self::client_ip() : '',
			)
		);

		if ( ! $id ) {
			return null;
		}

		if ( '' !== trim( (string) $c['greeting'] ) ) {
			TMB_Chat_DB::add_message(
				array(
					'session_id' => $id,
					'sender'     => 'system',
					'origin'     => 'system',
					'body'       => trim( (string) $c['greeting'] ),
				)
			);
		}

		$session = TMB_Chat_DB::get_session( $id );

		/**
		 * Fires right after a new conversation is created.
		 *
		 * @param int   $id      Session id.
		 * @param array $session Session row.
		 */
		do_action( 'tmb_chat_session_created', $id, $session );

		return $session;
	}

	/**
	 * POST /chat/message - visitor sends a message.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	/**
	 * POST /chat/selftest - browser side diagnostics.
	 *
	 * Only printed on ?tmb_selftest=1, so it never runs for normal visitors.
	 * It reports what the browser actually sees: is the widget in the DOM, did
	 * chat.js boot, did the click open the panel, and which CSS box the panel
	 * ended up in. That is the part of the story a server side report cannot
	 * see (theme js errors, css overrides, optimiser plugins).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_selftest( $request ) {
		$wait = $this->throttle( 'selftest', 30, 60 );

		if ( $wait ) {
			return $this->error( 'tmb_throttled', __( 'کمی صبر کنید.', 'tamas-box' ), 429 );
		}

		$params = $request->get_json_params();

		if ( ! is_array( $params ) ) {
			$params = (array) $request->get_params();
		}

		$clean = array();

		foreach ( $params as $key => $value ) {
			$key = substr( (string) preg_replace( '/[^A-Za-z0-9_]/', '', (string) $key ), 0, 28 );

			if ( '' === $key ) {
				continue;
			}

			if ( is_array( $value ) ) {
				$list = array();
				foreach ( array_slice( $value, 0, 8, true ) as $row ) {
					if ( is_scalar( $row ) ) {
						$list[] = substr( sanitize_text_field( (string) $row ), 0, 260 );
					}
				}
				$clean[ $key ] = $list;
			} elseif ( is_scalar( $value ) ) {
				$clean[ $key ] = substr( sanitize_text_field( (string) $value ), 0, 500 );
			}
		}

		$clean['time'] = time();

		TMB_Chat_DB::set_state( 'selftest', $clean );

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * POST /chat/message.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_send( $request ) {
		if ( ! self::enabled() ) {
			return $this->error( 'tmb_chat_off', __( 'چت آنلاین غیرفعال است.', 'tamas-box' ), 403 );
		}

		if ( ! $this->origin_ok( false ) ) {
			return $this->error( 'tmb_bad_origin', __( 'درخواست معتبر نیست.', 'tamas-box' ), 403 );
		}

		$c       = self::cfg();
		$token   = TMB_Chat_DB::clean_token( (string) $request->get_param( 'token' ) );
		$session = $token ? TMB_Chat_DB::get_session_by_token( $token ) : null;

		if ( ! $session ) {
			return $this->error( 'tmb_no_session', __( 'گفتگو پیدا نشد؛ صفحه را تازه کنید.', 'tamas-box' ), 404 );
		}

		if ( ! empty( $c['require_login'] ) && ! is_user_logged_in() ) {
			return $this->error( 'tmb_login_required', __( 'برای چت باید وارد حساب کاربری خود شوید.', 'tamas-box' ), 401 );
		}

		$retry = $this->throttle( 'msg', max( 1, (int) $c['rate_limit'] ), max( 10, (int) $c['rate_window'] ) );
		if ( $retry ) {
			return $this->error( 'tmb_rate', $c['rate_notice'], 429, array( 'retry_after' => $retry ) );
		}

		$text = self::sanitize_message( (string) $request->get_param( 'message' ), (int) $c['max_length'] );

		if ( '' === $text ) {
			return $this->error( 'tmb_empty', __( 'متن پیام خالی است.', 'tamas-box' ), 400 );
		}

		$message_id = $this->store_visitor_message( $session, $text );

		if ( ! $message_id ) {
			return $this->error( 'tmb_store_failed', __( 'ذخیره پیام ناموفق بود.', 'tamas-box' ), 500 );
		}

		$row     = TMB_Chat_DB::get_messages( (int) $session['id'], $message_id - 1, 1 );
		$message = $row ? $this->message_to_array( $row[0] ) : array(
			'id'     => $message_id,
			'sender' => 'visitor',
			'body'   => $text,
			'ts'     => time(),
		);

		$session = TMB_Chat_DB::get_session( (int) $session['id'] );

		return rest_ensure_response(
			array(
				'ok'      => true,
				'message' => $message,
				'session' => $this->session_to_array( $session ),
				'online'  => self::is_online() ? 1 : 0,
			)
		);
	}

	/**
	 * Store a visitor message and push it to Bale.
	 *
	 * @param array  $session Session row.
	 * @param string $text    Clean text.
	 * @return int Message id (0 on failure).
	 */
	public function store_visitor_message( $session, $text ) {
		$session_id = (int) $session['id'];
		$first      = (int) $session['visitor_count'] < 1;

		if ( 'closed' === $session['status'] ) {
			TMB_Chat_DB::update_session( $session_id, array( 'status' => 'open', 'closed_at' => 0 ) );
			$session['status'] = 'open';
		}

		$message_id = TMB_Chat_DB::add_message(
			array(
				'session_id' => $session_id,
				'sender'     => 'visitor',
				'origin'     => 'site',
				'body'       => $text,
			)
		);

		if ( ! $message_id ) {
			return 0;
		}

		$message = array(
			'id'         => $message_id,
			'body'       => $text,
			'created_at' => time(),
		);

		if ( TMB_Chat_Bale::is_ready() ) {
			if ( $first ) {
				TMB_Chat_Bale::notify_new_session( $session, $message );
			} else {
				TMB_Chat_Bale::notify_visitor_message( $session, $message );
			}
		}

		/**
		 * Fires after a visitor message is stored.
		 *
		 * @param int    $message_id
		 * @param string $text
		 * @param array  $session
		 */
		do_action( 'tmb_chat_visitor_message', $message_id, $text, $session );

		return $message_id;
	}

	/**
	 * Store an agent reply (from Bale or from the dashboard).
	 *
	 * @param int    $session_id Session.
	 * @param string $text       Message text.
	 * @param array  $attachment Optional attachment.
	 * @param string $agent_name Who answered.
	 * @param string $origin     'bale' | 'wp'.
	 * @param array  $meta       Bale chat/message ids.
	 * @return int Message id (0 on failure).
	 */
	public static function store_agent_message( $session_id, $text, $attachment = array(), $agent_name = '', $origin = 'bale', $meta = array() ) {
		$session = TMB_Chat_DB::get_session( absint( $session_id ) );

		if ( ! $session ) {
			return 0;
		}

		$c    = self::cfg();
		$text = self::sanitize_message( (string) $text, max( 500, (int) $c['max_length'] * 2 ) );

		if ( '' === $text && empty( $attachment ) ) {
			return 0;
		}

		if ( 'closed' === $session['status'] ) {
			TMB_Chat_DB::update_session( (int) $session['id'], array( 'status' => 'open', 'closed_at' => 0 ) );
		}

		$message_id = TMB_Chat_DB::add_message(
			array(
				'session_id'      => (int) $session['id'],
				'sender'          => 'agent',
				'origin'          => $origin,
				'body'            => $text,
				'attachment'      => $attachment,
				'agent_name'      => sanitize_text_field( (string) $agent_name ),
				'bale_chat_id'    => isset( $meta['chat_id'] ) ? (int) $meta['chat_id'] : 0,
				'bale_message_id' => isset( $meta['message_id'] ) ? (int) $meta['message_id'] : 0,
			)
		);

		if ( ! $message_id ) {
			return 0;
		}

		if ( 'wp' === $origin ) {
			TMB_Chat_Bale::sync_agent_reply( $session, array( 'body' => $text, 'agent_name' => $agent_name ) );
		}

		/**
		 * Fires after an agent reply is stored.
		 *
		 * @param int    $message_id
		 * @param string $text
		 * @param array  $session
		 * @param string $origin
		 */
		do_action( 'tmb_chat_agent_message', $message_id, $text, $session, $origin );

		return $message_id;
	}

	/**
	 * Open / close a conversation and leave a system note.
	 *
	 * @param int    $session_id Session.
	 * @param string $status     'open' or 'closed'.
	 * @param string $who        Who did it.
	 * @param bool   $notify     Tell Bale about it.
	 * @return bool
	 */
	public static function set_session_status( $session_id, $status, $who = '', $notify = true ) {
		$session_id = absint( $session_id );
		$session    = TMB_Chat_DB::get_session( $session_id );

		if ( ! $session ) {
			return false;
		}

		$status = ( 'closed' === $status ) ? 'closed' : 'open';

		if ( $session['status'] === $status ) {
			return true;
		}

		TMB_Chat_DB::update_session(
			$session_id,
			array(
				'status'    => $status,
				'closed_at' => ( 'closed' === $status ) ? time() : 0,
			)
		);

		$c   = self::cfg();
		$note = ( 'closed' === $status ) ? $c['closed_notice'] : __( 'گفتگو دوباره باز شد.', 'tamas-box' );

		if ( '' !== trim( (string) $note ) ) {
			TMB_Chat_DB::add_message(
				array(
					'session_id' => $session_id,
					'sender'     => 'system',
					'origin'     => 'system',
					'body'       => trim( (string) $note ),
				)
			);
		}

		if ( $notify && TMB_Chat_Bale::is_ready() ) {
			$line = ( 'closed' === $status )
				? '⚪ ' . esc_html__( 'گفتگو بسته شد', 'tamas-box' ) . ' #' . $session_id
				: '🟢 ' . esc_html__( 'گفتگو باز شد', 'tamas-box' ) . ' #' . $session_id;

			if ( $who ) {
				$line .= ' — ' . esc_html( $who );
			}

			TMB_Chat_Bale::notify_status( $session, $line );
		}

		do_action( 'tmb_chat_status_changed', $session_id, $status, $who );

		return true;
	}

	/**
	 * GET /chat/messages - the visitor poll.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_poll( $request ) {
		if ( ! self::enabled() ) {
			return $this->error( 'tmb_chat_off', __( 'چت آنلاین غیرفعال است.', 'tamas-box' ), 403 );
		}

		$c       = self::cfg();
		$token   = TMB_Chat_DB::clean_token( (string) $request->get_param( 'token' ) );
		$after   = absint( $request->get_param( 'after' ) );
		$session = $token ? TMB_Chat_DB::get_session_by_token( $token ) : null;

		// Polling mode: use this request as a cheap trigger for getUpdates.
		if ( 'poll' === $c['bale_mode'] && TMB_Chat_Bale::has_token() && ! get_transient( 'tmb_chat_pulled' ) ) {
			set_transient( 'tmb_chat_pulled', 1, 20 );
			TMB_Chat_Bale::pull_updates( 5 );
		}

		if ( ! $session ) {
			return rest_ensure_response(
				array(
					'ok'       => true,
					'messages' => array(),
					'session'  => null,
					'online'   => self::is_online() ? 1 : 0,
				)
			);
		}

		$rows = TMB_Chat_DB::get_messages( (int) $session['id'], $after, 100 );
		$out  = array();

		foreach ( $rows as $row ) {
			$out[] = $this->message_to_array( $row );
		}

		if ( $out ) {
			TMB_Chat_DB::mark_read( (int) $session['id'], 'visitor' );
			$session['unread_visitor'] = 0;
		}

		return rest_ensure_response(
			array(
				'ok'       => true,
				'messages' => $out,
				'session'  => $this->session_to_array( $session ),
				'online'   => self::is_online() ? 1 : 0,
				'server'   => time(),
			)
		);
	}

	/**
	 * POST /chat/read.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function rest_read( $request ) {
		$token   = TMB_Chat_DB::clean_token( (string) $request->get_param( 'token' ) );
		$session = $token ? TMB_Chat_DB::get_session_by_token( $token ) : null;

		if ( $session ) {
			TMB_Chat_DB::mark_read( (int) $session['id'], 'visitor' );
		}

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * POST /chat/close - the visitor ends the conversation.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_close( $request ) {
		$token   = TMB_Chat_DB::clean_token( (string) $request->get_param( 'token' ) );
		$session = $token ? TMB_Chat_DB::get_session_by_token( $token ) : null;

		if ( ! $session ) {
			return $this->error( 'tmb_no_session', __( 'گفتگو پیدا نشد.', 'tamas-box' ), 404 );
		}

		self::set_session_status( (int) $session['id'], 'closed', __( 'بازدیدکننده', 'tamas-box' ) );

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/**
	 * POST /chat/restart - start a fresh conversation (new token).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_restart( $request ) {
		if ( ! self::enabled() ) {
			return $this->error( 'tmb_chat_off', __( 'چت آنلاین غیرفعال است.', 'tamas-box' ), 403 );
		}

		$c = self::cfg();

		if ( empty( $c['allow_new_chat'] ) ) {
			return $this->error( 'tmb_not_allowed', __( 'امکان شروع گفتگوی جدید وجود ندارد.', 'tamas-box' ), 403 );
		}

		if ( ! $this->origin_ok( true ) ) {
			return $this->error( 'tmb_bad_origin', __( 'درخواست معتبر نیست.', 'tamas-box' ), 403 );
		}

		$retry = $this->throttle( 'restart', 10, HOUR_IN_SECONDS );
		if ( $retry ) {
			return $this->error( 'tmb_rate', $c['rate_notice'], 429, array( 'retry_after' => $retry ) );
		}

		$old_token = TMB_Chat_DB::clean_token( (string) $request->get_param( 'token' ) );
		$old       = $old_token ? TMB_Chat_DB::get_session_by_token( $old_token ) : null;

		if ( $old ) {
			self::set_session_status( (int) $old['id'], 'closed', __( 'بازدیدکننده', 'tamas-box' ), false );
		}

		$session = $this->create_session(
			array(
				'name'    => $old ? $old['name'] : '',
				'contact' => $old ? $old['contact'] : '',
			)
		);

		if ( ! $session ) {
			return $this->error( 'tmb_session_failed', __( 'ساخت گفتگو ناموفق بود.', 'tamas-box' ), 500 );
		}

		return rest_ensure_response(
			array(
				'ok'       => true,
				'token'    => $session['token'],
				'session'  => $this->session_to_array( $session ),
				'messages' => array(),
			)
		);
	}

	/**
	 * POST /chat/bale/{secret} - Bale webhook receiver.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_webhook( $request ) {
		$c      = self::cfg();
		$secret = (string) $request->get_param( 'secret' );

		TMB_Chat_DB::set_state( 'webhook_hits', (int) TMB_Chat_DB::get_state( 'webhook_hits', 0 ) + 1 );

		/*
		 * Keep the raw body of the newest calls. The WordPress JSON parser
		 * caches the body, so reading it here is free and it is the only way
		 * to see what Bale really sent when every other check looks fine.
		 */
		$raw = (string) $request->get_body();
		TMB_Chat_Bale::log_raw( $raw, 'webhook' );

		if ( empty( $c['bale_enabled'] ) || '' === (string) $c['bale_secret'] ) {
			TMB_Chat_Bale::trace( 'webhook-rejected: bale off or no secret' );
			return $this->error( 'tmb_webhook_off', __( 'وب‌هوک غیرفعال است.', 'tamas-box' ), 403 );
		}

		if ( ! hash_equals( (string) $c['bale_secret'], $secret ) ) {
			TMB_Chat_Bale::trace( 'webhook-rejected: wrong secret in url' );
			return $this->error( 'tmb_bad_secret', __( 'کلید نامعتبر است.', 'tamas-box' ), 403 );
		}

		// Bale may send its own secret header when it is configured.
		$header = isset( $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] )
			? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ) )
			: '';

		if ( '' !== $header && ! hash_equals( (string) $c['bale_secret'], $header ) ) {
			TMB_Chat_Bale::trace( 'webhook-rejected: wrong secret header' );
			return $this->error( 'tmb_bad_secret', __( 'کلید نامعتبر است.', 'tamas-box' ), 403 );
		}

		$update = $request->get_json_params();

		if ( empty( $update ) || ! is_array( $update ) ) {
			$update = json_decode( $raw, true );
		}

		if ( ! is_array( $update ) ) {
			TMB_Chat_Bale::trace( 'webhook-rejected: unreadable body' );
			return $this->error( 'tmb_bad_update', __( 'بدنه درخواست نامعتبر است.', 'tamas-box' ), 400 );
		}

		TMB_Chat_DB::maybe_install();

		try {
			TMB_Chat_Bale::handle_update( $update );
		} catch ( Exception $e ) {
			TMB_Chat_DB::set_state( 'webhook_error', substr( $e->getMessage(), 0, 200 ) );
			TMB_Chat_Bale::trace( 'webhook-exception', array( 'error' => substr( $e->getMessage(), 0, 160 ) ) );
		} catch ( Throwable $e ) {
			TMB_Chat_DB::set_state( 'webhook_error', substr( $e->getMessage(), 0, 200 ) );
			TMB_Chat_Bale::trace( 'webhook-fatal', array( 'error' => substr( $e->getMessage(), 0, 160 ) ) );
		}

		TMB_Chat_DB::set_state( 'last_webhook', time() );

		return rest_ensure_response( array( 'ok' => true ) );
	}

	/* ---- dashboard inbox ---- */

	/**
	 * GET /chat/admin/sessions.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function rest_admin_sessions( $request ) {
		TMB_Chat_DB::maybe_install();

		$list = TMB_Chat_DB::sessions_list(
			array(
				'status'   => sanitize_key( (string) $request->get_param( 'status' ) ),
				'search'   => sanitize_text_field( (string) $request->get_param( 'search' ) ),
				'page'     => absint( $request->get_param( 'paged' ) ) ? absint( $request->get_param( 'paged' ) ) : 1,
				'per_page' => absint( $request->get_param( 'per_page' ) ) ? absint( $request->get_param( 'per_page' ) ) : 25,
				'unread'   => (bool) $request->get_param( 'unread' ),
			)
		);

		$items = array();
		foreach ( $list['items'] as $row ) {
			$items[] = $this->session_to_array( $row, true );
		}

		return rest_ensure_response(
			array(
				'ok'       => true,
				'items'    => $items,
				'total'    => (int) $list['total'],
				'pages'    => (int) $list['pages'],
				'counters' => TMB_Chat_DB::counters(),
			)
		);
	}

	/**
	 * GET /chat/admin/session/{id}.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_admin_session( $request ) {
		TMB_Chat_DB::maybe_install();

		$id      = absint( $request->get_param( 'id' ) );
		$session = TMB_Chat_DB::get_session( $id );

		if ( ! $session ) {
			return $this->error( 'tmb_no_session', __( 'گفتگو پیدا نشد.', 'tamas-box' ), 404 );
		}

		$rows = TMB_Chat_DB::last_messages( $id, 200 );
		$out  = array();

		foreach ( $rows as $row ) {
			$out[] = $this->message_to_array( $row );
		}

		TMB_Chat_DB::mark_read( $id, 'agent' );

		return rest_ensure_response(
			array(
				'ok'       => true,
				'session'  => $this->session_to_array( $session, true ),
				'messages' => $out,
				'counters' => TMB_Chat_DB::counters(),
			)
		);
	}

	/**
	 * POST /chat/admin/message.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_admin_message( $request ) {
		TMB_Chat_DB::maybe_install();

		$id      = absint( $request->get_param( 'session' ) );
		$session = TMB_Chat_DB::get_session( $id );

		if ( ! $session ) {
			return $this->error( 'tmb_no_session', __( 'گفتگو پیدا نشد.', 'tamas-box' ), 404 );
		}

		$c    = self::cfg();
		$text = self::sanitize_message( (string) $request->get_param( 'message' ), max( 1000, (int) $c['max_length'] * 2 ) );

		if ( '' === $text ) {
			return $this->error( 'tmb_empty', __( 'متن پیام خالی است.', 'tamas-box' ), 400 );
		}

		$user = wp_get_current_user();
		$name = $user ? $user->display_name : '';

		$message_id = self::store_agent_message( $id, $text, array(), $name, 'wp' );

		if ( ! $message_id ) {
			return $this->error( 'tmb_store_failed', __( 'ذخیره پیام ناموفق بود.', 'tamas-box' ), 500 );
		}

		$rows = TMB_Chat_DB::get_messages( $id, $message_id - 1, 1 );

		return rest_ensure_response(
			array(
				'ok'      => true,
				'message' => $rows ? $this->message_to_array( $rows[0] ) : array(),
				'session' => $this->session_to_array( TMB_Chat_DB::get_session( $id ), true ),
			)
		);
	}

	/**
	 * POST /chat/admin/status.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_admin_status( $request ) {
		$id      = absint( $request->get_param( 'session' ) );
		$status  = sanitize_key( (string) $request->get_param( 'status' ) );
		$session = TMB_Chat_DB::get_session( $id );

		if ( ! $session ) {
			return $this->error( 'tmb_no_session', __( 'گفتگو پیدا نشد.', 'tamas-box' ), 404 );
		}

		$user = wp_get_current_user();
		self::set_session_status( $id, $status, $user ? $user->display_name : '' );

		return rest_ensure_response(
			array(
				'ok'      => true,
				'session' => $this->session_to_array( TMB_Chat_DB::get_session( $id ), true ),
			)
		);
	}

	/**
	 * POST /chat/admin/delete.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function rest_admin_delete( $request ) {
		$id = absint( $request->get_param( 'session' ) );

		if ( ! TMB_Chat_DB::get_session( $id ) ) {
			return $this->error( 'tmb_no_session', __( 'گفتگو پیدا نشد.', 'tamas-box' ), 404 );
		}

		TMB_Chat_DB::delete_session( $id );

		return rest_ensure_response(
			array(
				'ok'       => true,
				'counters' => TMB_Chat_DB::counters(),
			)
		);
	}

	/* ---------------------------------------------------------------------
	 * Serializers
	 * ------------------------------------------------------------------ */

	/**
	 * Public shape of a message row.
	 *
	 * @param array $row DB row.
	 * @return array
	 */
	public function message_to_array( $row ) {
		$attachment = array();

		if ( ! empty( $row['attachment'] ) ) {
			$decoded = json_decode( (string) $row['attachment'], true );
			if ( is_array( $decoded ) ) {
				$attachment = $decoded;
				if ( ! empty( $attachment['url'] ) ) {
					$attachment['url'] = esc_url_raw( $attachment['url'] );
				}
			}
		}

		return array(
			'id'         => (int) $row['id'],
			'sender'     => $row['sender'],
			'body'       => (string) $row['body'],
			'attachment' => $attachment,
			'agent'      => (string) $row['agent_name'],
			'origin'     => (string) $row['origin'],
			'ts'         => (int) $row['created_at'],
		);
	}

	/**
	 * Public shape of a session row.
	 *
	 * @param array $row   DB row.
	 * @param bool  $admin Include private details (ip, page, user id).
	 * @return array
	 */
	public function session_to_array( $row, $admin = false ) {
		if ( ! $row ) {
			return null;
		}

		$out = array(
			'id'        => (int) $row['id'],
			'status'    => $row['status'],
			'name'      => (string) $row['name'],
			'unread'    => (int) $row['unread_visitor'],
			'createdAt' => (int) $row['created_at'],
			'lastAt'    => (int) $row['last_at'],
		);

		if ( $admin ) {
			$out['contact']      = (string) $row['contact'];
			$out['pageUrl']      = (string) $row['page_url'];
			$out['ip']           = (string) $row['ip'];
			$out['userId']       = (int) $row['user_id'];
			$out['agentName']    = (string) $row['agent_name'];
			$out['unreadAgent']  = (int) $row['unread_agent'];
			$out['visitorCount'] = (int) $row['visitor_count'];
			$out['agentCount']   = (int) $row['agent_count'];
			$out['lastMessage']  = (string) $row['last_message'];
			$out['lastSender']   = (string) $row['last_sender'];
			$out['closedAt']     = (int) $row['closed_at'];
		}

		return $out;
	}

	/* ---------------------------------------------------------------------
	 * Cron
	 * ------------------------------------------------------------------ */

	/**
	 * Add a 2 minute schedule.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public function cron_interval( $schedules ) {
		if ( ! isset( $schedules['tmb_two_minutes'] ) ) {
			$schedules['tmb_two_minutes'] = array(
				'interval' => 120,
				'display'  => __( 'هر ۲ دقیقه (تماس باکس)', 'tamas-box' ),
			);
		}
		return $schedules;
	}

	/**
	 * Make sure the cron event exists.
	 *
	 * @return void
	 */
	public function cron_setup() {
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + 60, 'tmb_two_minutes', self::CRON_HOOK );
		}
	}

	/**
	 * Plain text diagnostics on ?tmb_chat_report=1 (admins only).
	 *
	 * Much easier to share than a screenshot: open the url, select all, copy.
	 *
	 * @return void
	 */
	public function maybe_report() {
		if ( ! isset( $_GET['tmb_chat_report'] ) ) {
			return;
		}

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'برای دیدن این گزارش باید با حساب مدیر وارد شده باشید.', 'tamas-box' ), 403 );
		}

		nocache_headers();
		header( 'Content-Type: text/plain; charset=utf-8' );

		echo TMB_Chat_Admin::diag_report(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped

		exit;
	}

	/**
	 * Fix the two settings mistakes that silently break the Bale bridge.
	 *
	 * 1. Webhook mode on a site whose home url is not https - Bale refuses to
	 *    call an insecure url, so polling is the only thing that can work.
	 * 2. Nothing here rewrites a token or a chat id: those stay the admin's job.
	 *
	 * @return void
	 */
	public function self_heal() {
		if ( is_admin() ) {
			return;
		}

		$c = self::cfg();

		if ( empty( $c['enabled'] ) || empty( $c['bale_enabled'] ) || '' === trim( (string) $c['bale_token'] ) ) {
			return;
		}

		$https  = ( 'https' === wp_parse_url( home_url(), PHP_URL_SCHEME ) );
		$switched = (int) TMB_Chat_DB::get_state( 'mode_switched_http', 0 );

		if ( ! $https && 'webhook' === $c['bale_mode'] ) {
			self::update_chat_settings( array( 'bale_mode' => 'poll' ) );
			TMB_Chat_DB::set_state( 'mode_switched_http', 1 );
			return;
		}

		if ( $https && $switched ) {
			TMB_Chat_DB::set_state( 'mode_switched_http', 0 );
		}
	}

	/**
	 * Patch a few chat settings without going through the settings form.
	 *
	 * @param array $patch Key => value pairs inside the "chat" sub array.
	 * @return bool
	 */
	public static function update_chat_settings( $patch ) {
		$raw = get_option( TMB_OPTION, array() );

		if ( ! is_array( $raw ) ) {
			return false;
		}
		if ( ! isset( $raw['chat'] ) || ! is_array( $raw['chat'] ) ) {
			$raw['chat'] = array();
		}

		foreach ( (array) $patch as $key => $value ) {
			$raw['chat'][ $key ] = $value;
		}

		update_option( TMB_OPTION, $raw );
		self::reset_cfg_cache();

		return true;
	}

	/**
	 * Cron callback: poll Bale when needed and prune old data.
	 *
	 * @return void
	 */
	public function cron_tick() {
		if ( ! self::enabled() ) {
			return;
		}

		$c = self::cfg();

		if ( 'poll' === $c['bale_mode'] && TMB_Chat_Bale::has_token() ) {
			TMB_Chat_Bale::pull_updates( 20 );
		} elseif ( 'webhook' === $c['bale_mode'] && TMB_Chat_Bale::has_token() ) {
			$this->rescue_pending_updates();
		}

		$last_prune = (int) TMB_Chat_DB::get_state( 'last_prune', 0 );

		if ( $last_prune < time() - DAY_IN_SECONDS ) {
			TMB_Chat_DB::prune( max( 1, (int) $c['retain_days'] ) );
			TMB_Chat_DB::prune_map( 30 );
			TMB_Chat_DB::set_state( 'last_prune', time() );
		}
	}

	/**
	 * Webhook-mode safety net.
	 *
	 * getWebhookInfo tells us how many updates Bale still has queued for us. A
	 * queue that is not empty while our last webhook hit is old means Bale
	 * cannot reach the site (or something eats the answers): the updates are
	 * then read with getUpdates instead, so no reply is ever lost. Runs at most
	 * every 3 minutes and actually drains at most every 10 minutes.
	 *
	 * @return void
	 */
	protected function rescue_pending_updates() {
		if ( (int) TMB_Chat_DB::get_state( 'last_pending_check', 0 ) > time() - 180 ) {
			return;
		}

		TMB_Chat_DB::set_state( 'last_pending_check', time() );

		$info = TMB_Chat_Bale::webhook_info();

		if ( is_wp_error( $info ) ) {
			return;
		}

		$r       = ( isset( $info['result'] ) && is_array( $info['result'] ) ) ? $info['result'] : array();
		$pending = isset( $r['pending_update_count'] ) ? (int) $r['pending_update_count'] : 0;
		$url     = isset( $r['url'] ) ? trim( (string) $r['url'] ) : '';
		$last    = (int) TMB_Chat_DB::get_state( 'last_webhook', 0 );

		TMB_Chat_DB::set_state( 'pending_updates', $pending );

		if ( ! empty( $r['last_error_message'] ) ) {
			TMB_Chat_DB::set_state( 'webhook_error', substr( (string) $r['last_error_message'], 0, 200 ) );
		}

		/* No webhook registered at all: put it back before doing anything else. */
		if ( '' === $url ) {
			$set = TMB_Chat_Bale::set_webhook();

			if ( ! is_wp_error( $set ) ) {
				TMB_Chat_DB::set_state( 'webhook_error', '' );
				return;
			}

			TMB_Chat_DB::set_state( 'webhook_error', 'setWebhook: ' . substr( $set->get_error_message(), 0, 160 ) );
		}

		/* Nothing queued and the webhook is registered - all good. */
		if ( '' !== $url && $pending < 1 ) {
			return;
		}

		/* Bale is delivering normally; it retries failed calls on its own. */
		if ( '' !== $url && $last > time() - 180 ) {
			return;
		}

		if ( (int) TMB_Chat_DB::get_state( 'last_auto_drain', 0 ) > time() - 600 ) {
			return;
		}

		TMB_Chat_DB::set_state( 'last_auto_drain', time() );
		TMB_Chat_Bale::drain_updates( 100 );
		TMB_Chat_DB::set_state( 'pending_updates', 0 );
	}

	/**
	 * Remove scheduled events (deactivation).
	 *
	 * @return void
	 */
	public static function clear_cron() {
		$timestamp = wp_next_scheduled( self::CRON_HOOK );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, self::CRON_HOOK );
		}
	}
}

/**
 * Global accessor.
 *
 * @return TMB_Chat
 */
function tmb_chat() {
	return TMB_Chat::instance();
}
