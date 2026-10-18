<?php
/**
 * Dashboard side of the live chat module:
 *   - the "چت آنلاین" tab inside the Tamas Box settings screen
 *   - the "گفتگوها" inbox page
 *   - AJAX helpers (test the bot token, register the webhook, ...)
 *
 * @package Tamas_Box
 * @since   3.2.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TMB_Chat_Admin {

	const INBOX_SLUG = 'tamas-box-chats';

	/**
	 * Shared instance (used by the settings screen too).
	 *
	 * @var TMB_Chat_Admin|null
	 */
	private static $instance = null;

	/**
	 * Get the single instance.
	 *
	 * @return TMB_Chat_Admin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'menu' ), 20 );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );

		add_action( 'wp_ajax_tmb_chat_test', array( $this, 'ajax_test' ) );
		add_action( 'wp_ajax_tmb_chat_set_webhook', array( $this, 'ajax_set_webhook' ) );
		add_action( 'wp_ajax_tmb_chat_delete_webhook', array( $this, 'ajax_delete_webhook' ) );
		add_action( 'wp_ajax_tmb_chat_webhook_info', array( $this, 'ajax_webhook_info' ) );
		add_action( 'wp_ajax_tmb_chat_poll_now', array( $this, 'ajax_poll_now' ) );
	}

	/**
	 * Submenu entry + unread badge.
	 *
	 * @return void
	 */
	public function menu() {
		$label = __( 'گفتگوها', 'tamas-box' );

		if ( TMB_Chat::enabled() ) {
			$counters = TMB_Chat_DB::counters();

			if ( ! empty( $counters['unread'] ) ) {
				$label .= sprintf(
					' <span class="awaiting-mod count-%1$d"><span class="pending-count">%1$d</span></span>',
					(int) $counters['unread']
				);
			}
		}

		add_submenu_page(
			'tamas-box',
			__( 'گفتگوهای آنلاین', 'tamas-box' ),
			$label,
			'manage_options',
			self::INBOX_SLUG,
			array( $this, 'render_inbox' )
		);
	}

	/**
	 * Enqueue inbox / settings assets.
	 *
	 * @param string $hook Current screen.
	 * @return void
	 */
	public function assets( $hook ) {
		$is_chat_page = ( false !== strpos( $hook, self::INBOX_SLUG ) );
		$is_settings  = ( false !== strpos( $hook, 'tamas-box' ) && ! $is_chat_page );

		if ( ! $is_chat_page && ! $is_settings ) {
			return;
		}

		wp_enqueue_style( 'tmb-admin', TMB_URL . 'assets/css/admin.css', array(), TMB_VERSION );
		wp_enqueue_style( 'tmb-chat-admin', TMB_URL . 'assets/css/chat-admin.css', array( 'tmb-admin' ), TMB_VERSION );
		wp_enqueue_script( 'tmb-chat-admin', TMB_URL . 'assets/js/admin-chat.js', array( 'jquery' ), TMB_VERSION, true );

		wp_localize_script(
			'tmb-chat-admin',
			'TMB_CHAT_ADMIN',
			array(
				'rest'      => esc_url_raw( rest_url( TMB_Chat::REST_NAMESPACE . '/chat' ) ),
				'nonce'     => wp_create_nonce( 'wp_rest' ),
				'ajaxUrl'   => admin_url( 'admin-ajax.php' ),
				'ajaxNonce' => wp_create_nonce( 'tmb_chat_admin' ),
				'inbox'     => $is_chat_page ? 1 : 0,
				'i18n'      => array(
					'loading'      => __( 'در حال بارگذاری…', 'tamas-box' ),
					'empty'        => __( 'گفتگویی وجود ندارد.', 'tamas-box' ),
					'noSelection'  => __( 'یک گفتگو را از فهرست انتخاب کنید.', 'tamas-box' ),
					'send'         => __( 'ارسال', 'tamas-box' ),
					'sending'      => __( 'در حال ارسال…', 'tamas-box' ),
					'open'         => __( 'باز', 'tamas-box' ),
					'closed'       => __( 'بسته', 'tamas-box' ),
					'closeChat'    => __( 'بستن گفتگو', 'tamas-box' ),
					'reopenChat'   => __( 'باز کردن گفتگو', 'tamas-box' ),
					'deleteChat'   => __( 'حذف گفتگو', 'tamas-box' ),
					'confirmDelete'=> __( 'این گفتگو و همه پیام‌هایش برای همیشه حذف شود؟', 'tamas-box' ),
					'guest'        => __( 'مهمان', 'tamas-box' ),
					'visitor'      => __( 'بازدیدکننده', 'tamas-box' ),
					'agent'        => __( 'پشتیبانی', 'tamas-box' ),
					'system'       => __( 'سیستم', 'tamas-box' ),
					'error'        => __( 'خطا در ارتباط با سرور.', 'tamas-box' ),
					'all'          => __( 'همه', 'tamas-box' ),
					'newMessages'  => __( 'پیام جدید', 'tamas-box' ),
					'working'      => __( 'در حال انجام…', 'tamas-box' ),
				),
			)
		);
	}

	/* ---------------------------------------------------------------------
	 * Settings tab
	 * ------------------------------------------------------------------ */

	/**
	 * The "چت آنلاین" tab, rendered inside the main settings form.
	 *
	 * @param string $o Option name.
	 * @return void
	 */
	public function settings_tab( $o ) {
		$c       = TMB_Settings::chat();
		$n       = $o . '[chat]';
		$icons   = TMB_Icons::all();
		$days    = TMB_Visibility::days();
		$ready   = TMB_Chat_Bale::is_ready();
		$error   = TMB_Chat_Bale::last_error();
		$state   = TMB_Chat_DB::state();
		$webhook = TMB_Chat_Bale::webhook_url();
		$https   = ( 0 === strpos( home_url(), 'https://' ) );
		?>
		<section id="tab-chat" class="tmb-panel">
			<div class="tmb-section-head">
				<div>
					<h2><?php esc_html_e( 'چت آنلاین', 'tamas-box' ); ?></h2>
					<p class="tmb-desc">
						<?php esc_html_e( 'بازدیدکننده داخل سایت پیام می‌دهد، پیام در بله به دست شما می‌رسد و پاسخ شما دوباره در همان چت‌باکس سایت نمایش داده می‌شود.', 'tamas-box' ); ?>
					</p>
				</div>
			</div>

			<div class="tmb-field tmb-switch-row tmb-chat-master">
				<label class="tmb-switch">
					<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[enabled]" value="1" <?php checked( $c['enabled'], 1 ); ?>>
					<span class="tmb-slider"></span>
				</label>
				<div>
					<strong><?php esc_html_e( 'فعال کردن چت آنلاین', 'tamas-box' ); ?></strong>
					<p class="tmb-desc"><?php esc_html_e( 'با خاموش بودن این گزینه، هیچ ویجت چتی در سایت نمایش داده نمی‌شود.', 'tamas-box' ); ?></p>
				</div>
			</div>

			<!-- ============ اتصال به بله ============ -->
			<div class="tmb-card tmb-bale-card">
				<h3>🔗 <?php esc_html_e( 'اتصال به بله', 'tamas-box' ); ?></h3>
				<p class="tmb-desc">
					<?php esc_html_e( 'توکن بازوی بله را از «بات‌فادر بله» (@botfather در ble.ir) بگیرید و اینجا وارد کنید.', 'tamas-box' ); ?>
				</p>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'توکن بازو (Bot Token)', 'tamas-box' ); ?></label>
						<input type="text" class="ltr tmb-chat-token" name="<?php echo esc_attr( $n ); ?>[bale_token]" value="<?php echo esc_attr( $c['bale_token'] ); ?>" placeholder="123456789:abcdIuZmK5qNEm2A1BhUaAg7MPJv1O9KCcBQB2ro" autocomplete="off" spellcheck="false" dir="ltr">
						<p class="tmb-desc"><?php esc_html_e( 'قالب: عدد دونقطه رشته. این مقدار فقط در دیتابیس سایت شما ذخیره می‌شود.', 'tamas-box' ); ?></p>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'آدرس API', 'tamas-box' ); ?></label>
						<input type="text" class="ltr tmb-chat-base" name="<?php echo esc_attr( $n ); ?>[bale_api_base]" value="<?php echo esc_attr( $c['bale_api_base'] ); ?>" dir="ltr">
						<p class="tmb-desc">
							<?php esc_html_e( 'عادی:', 'tamas-box' ); ?> <code>https://tapi.bale.ai/bot</code><br>
							<?php esc_html_e( 'کسب‌وکاری:', 'tamas-box' ); ?> <code>https://tapi.bale.ai/business/bot</code>
						</p>
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'شناسه چت مدیران (هر خط یک مورد)', 'tamas-box' ); ?></label>
					<textarea class="ltr tmb-chat-ids" rows="3" name="<?php echo esc_attr( $n ); ?>[bale_chat_ids]" placeholder="-1001234567890&#10;987654321" dir="ltr"><?php echo esc_textarea( $c['bale_chat_ids'] ); ?></textarea>
					<p class="tmb-desc">
						<?php esc_html_e( 'برای فهمیدن شناسه چت خود، بعد از ذخیره تنظیمات، در بله به بازوی خود پیام /id بدهید. می‌توانید شناسه یک گروه را هم وارد کنید تا همه مدیران در یک گروه پیام‌ها را ببینند و پاسخ دهند.', 'tamas-box' ); ?>
					</p>
				</div>

				<div class="tmb-chat-actions">
					<button type="button" class="button" data-tmb-chat="test">🔌 <?php esc_html_e( 'تست اتصال', 'tamas-box' ); ?></button>
					<button type="button" class="button button-primary" data-tmb-chat="set-webhook">📡 <?php esc_html_e( 'ثبت وب‌هوک', 'tamas-box' ); ?></button>
					<button type="button" class="button" data-tmb-chat="webhook-info">ℹ️ <?php esc_html_e( 'وضعیت وب‌هوک', 'tamas-box' ); ?></button>
					<button type="button" class="button" data-tmb-chat="delete-webhook">🗑 <?php esc_html_e( 'حذف وب‌هوک', 'tamas-box' ); ?></button>
					<button type="button" class="button" data-tmb-chat="poll-now">⬇️ <?php esc_html_e( 'دریافت پیام‌های بله (دستی)', 'tamas-box' ); ?></button>
				</div>

				<div class="tmb-chat-result" data-tmb-chat-result hidden></div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'آدرس وب‌هوک (خودکار ساخته می‌شود)', 'tamas-box' ); ?></label>
					<div class="tmb-webhook-row">
						<input type="text" class="ltr" id="tmb-webhook-url" value="<?php echo esc_attr( $webhook ); ?>" readonly onclick="this.select()" dir="ltr">
						<button type="button" class="button" data-tmb-chat="copy-webhook"><?php esc_html_e( 'کپی', 'tamas-box' ); ?></button>
					</div>
					<input type="hidden" name="<?php echo esc_attr( $n ); ?>[bale_secret]" value="<?php echo esc_attr( $c['bale_secret'] ); ?>">
					<p class="tmb-desc">
						<?php esc_html_e( 'کلید امنیتی داخل آدرس وب‌هوک قرار دارد؛ آن را در اختیار کسی نگذارید. با تغییر آن، وب‌هوک را دوباره ثبت کنید.', 'tamas-box' ); ?>
					</p>
					<?php if ( ! $https ) : ?>
						<p class="tmb-note tmb-note-warn">
							<?php esc_html_e( 'سایت شما با HTTPS باز نمی‌شود. بله فقط وب‌هوک HTTPS (پورت ۴۴۳ یا ۸۸) را قبول می‌کند؛ در غیر این صورت حالت «دریافت خودکار» را انتخاب کنید.', 'tamas-box' ); ?>
						</p>
					<?php endif; ?>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'روش دریافت پاسخ مدیران', 'tamas-box' ); ?></label>
					<div class="tmb-radio-cards">
						<label class="tmb-radio-card <?php echo 'webhook' === $c['bale_mode'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[bale_mode]" value="webhook" <?php checked( $c['bale_mode'], 'webhook' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'وب‌هوک (پیشنهادی)', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'بله بلافاصله پیام مدیر را به سایت خبر می‌دهد؛ پاسخ آنی است.', 'tamas-box' ); ?></span>
						</label>
						<label class="tmb-radio-card <?php echo 'poll' === $c['bale_mode'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[bale_mode]" value="poll" <?php checked( $c['bale_mode'], 'poll' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'دریافت خودکار (getUpdates)', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'برای سایت‌های بدون HTTPS یا وقتی وب‌هوک کار نمی‌کند. کمی تأخیر دارد.', 'tamas-box' ); ?></span>
						</label>
					</div>
					<p class="tmb-desc">
						<?php
						printf(
							/* translators: %s: last webhook time */
							esc_html__( 'آخرین دریافت وب‌هوک: %s', 'tamas-box' ),
							! empty( $state['last_webhook'] )
								? '<code>' . esc_html( wp_date( 'Y/m/d H:i', (int) $state['last_webhook'] ) ) . '</code>'
								: '<code>—</code>'
						);
						?>
					</p>
				</div>

				<?php if ( ! empty( $error['message'] ) ) : ?>
					<p class="tmb-note tmb-note-warn">
						<strong><?php esc_html_e( 'آخرین خطای بله:', 'tamas-box' ); ?></strong>
						<code><?php echo esc_html( $error['message'] ); ?></code>
						<?php if ( ! empty( $error['time'] ) ) : ?>
							(<?php echo esc_html( wp_date( 'Y/m/d H:i', (int) $error['time'] ) ); ?>)
						<?php endif; ?>
					</p>
				<?php endif; ?>

				<?php if ( ! empty( $c['bale_bot_username'] ) ) : ?>
					<p class="tmb-note tmb-note-ok">
						<?php
						printf(
							/* translators: 1: bot name, 2: bot username */
							esc_html__( 'بازوی متصل: %1$s (@%2$s)', 'tamas-box' ),
							esc_html( $c['bale_bot_name'] ? $c['bale_bot_name'] : $c['bale_bot_username'] ),
							esc_html( $c['bale_bot_username'] )
						);
						?>
					</p>
				<?php endif; ?>

				<h4><?php esc_html_e( 'رفتار بازو', 'tamas-box' ); ?></h4>
				<div class="tmb-grid-2">
					<?php
					$behaviours = array(
						'bale_enabled'       => array( __( 'ارسال پیام‌ها به بله', 'tamas-box' ), __( 'اگر خاموش شود، گفتگوها فقط در پیشخوان سایت ذخیره می‌شوند.', 'tamas-box' ) ),
						'bale_notify_new'    => array( __( 'اعلان گفتگوی جدید', 'tamas-box' ), __( 'اولین پیام هر بازدیدکننده با جزئیات کامل ارسال می‌شود.', 'tamas-box' ) ),
						'bale_include_page'  => array( __( 'ارسال آدرس صفحه', 'tamas-box' ), __( 'مشخص می‌شود کاربر از کدام صفحه پیام داده است.', 'tamas-box' ) ),
						'bale_include_ip'    => array( __( 'ارسال IP کاربر', 'tamas-box' ), __( 'برای شناسایی کاربران مزاحم. توجه به حریم خصوصی داشته باشید.', 'tamas-box' ) ),
						'bale_default_reply' => array( __( 'پاسخ بدون کد = آخرین گفتگو', 'tamas-box' ), __( 'اگر مدیر بدون Reply و بدون کد پیام بنویسد، به تازه‌ترین گفتگوی باز می‌رود.', 'tamas-box' ) ),
						'bale_commands'      => array( __( 'فعال بودن دستورها', 'tamas-box' ), __( 'دستورهایی مثل /chats ، /reply ، /id', 'tamas-box' ) ),
						'bale_media'         => array( __( 'دریافت عکس و صوت از بله', 'tamas-box' ), __( 'فایل‌هایی که مدیر در بله می‌فرستد در سایت هم نمایش داده می‌شوند.', 'tamas-box' ) ),
						'bale_sync_admin'    => array( __( 'نمایش پاسخ‌های پیشخوان در بله', 'tamas-box' ), __( 'اگر از داخل وردپرس جواب بدهید، همان متن در بله هم ثبت می‌شود.', 'tamas-box' ) ),
						'only_admins_reply'  => array( __( 'فقط چت‌های معرفی‌شده مجازند', 'tamas-box' ), __( 'به افراد متفرقه که به بازو پیام دهند پاسخی داده نمی‌شود.', 'tamas-box' ) ),
					);
					foreach ( $behaviours as $key => $row ) :
						?>
						<div class="tmb-field tmb-switch-row">
							<label class="tmb-switch">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[<?php echo esc_attr( $key ); ?>]" value="1" <?php checked( ! empty( $c[ $key ] ), 1 ); ?>>
								<span class="tmb-slider"></span>
							</label>
							<div>
								<strong><?php echo esc_html( $row[0] ); ?></strong>
								<p class="tmb-desc"><?php echo esc_html( $row[1] ); ?></p>
							</div>
						</div>
					<?php endforeach; ?>
				</div>

				<div class="tmb-helpbox">
					<strong><?php esc_html_e( 'راه‌اندازی در ۴ قدم', 'tamas-box' ); ?></strong>
					<ol>
						<li><?php esc_html_e( 'توکن بازو را وارد کنید و «تست اتصال» را بزنید تا از درستی توکن مطمئن شوید.', 'tamas-box' ); ?></li>
						<li><?php esc_html_e( 'تنظیمات را ذخیره کنید.', 'tamas-box' ); ?></li>
						<li><?php esc_html_e( 'در بله به بازوی خود پیام /id بدهید و عددی که می‌فرستد را در «شناسه چت مدیران» بگذارید (برای گروه، بازو را عضو گروه کنید و در گروه /id بفرستید).', 'tamas-box' ); ?></li>
						<li><?php esc_html_e( 'دکمه «ثبت وب‌هوک» را بزنید. تمام! حالا در سایت چت را باز کنید و یک پیام تستی بفرستید.', 'tamas-box' ); ?></li>
					</ol>
				</div>
			</div>

			<!-- ============ دکمه و نمایش ============ -->
			<div class="tmb-card">
				<h3>💬 <?php esc_html_e( 'دکمه و نمایش', 'tamas-box' ); ?></h3>

				<div class="tmb-field">
					<label><?php esc_html_e( 'چطور چت باز شود؟', 'tamas-box' ); ?></label>
					<div class="tmb-radio-cards">
						<label class="tmb-radio-card <?php echo 'item' === $c['launcher'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[launcher]" value="item" <?php checked( $c['launcher'], 'item' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'فقط به‌عنوان آیتم باکس تماس', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'در تب «آیتم‌ها» هر باکس، دکمه «+ آیتم چت آنلاین» را بزنید.', 'tamas-box' ); ?></span>
						</label>
						<label class="tmb-radio-card <?php echo 'button' === $c['launcher'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[launcher]" value="button" <?php checked( $c['launcher'], 'button' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'فقط دکمه شناور چت', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'یک دکمه مستقل روی صفحه نمایش داده می‌شود.', 'tamas-box' ); ?></span>
						</label>
						<label class="tmb-radio-card <?php echo 'both' === $c['launcher'] ? 'selected' : ''; ?>">
							<input type="radio" name="<?php echo esc_attr( $n ); ?>[launcher]" value="both" <?php checked( $c['launcher'], 'both' ); ?>>
							<span class="tmb-rc-title"><?php esc_html_e( 'هر دو', 'tamas-box' ); ?></span>
							<span class="tmb-rc-desc"><?php esc_html_e( 'هم آیتم داخل باکس، هم دکمه شناور مستقل.', 'tamas-box' ); ?></span>
						</label>
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'موقعیت دکمه شناور', 'tamas-box' ); ?></label>
						<select name="<?php echo esc_attr( $n ); ?>[launcher_position]">
							<?php foreach ( TMB_Settings::positions() as $key => $label ) : ?>
								<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $c['launcher_position'], $key ); ?>><?php echo esc_html( $label ); ?></option>
							<?php endforeach; ?>
						</select>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'فاصله افقی (px)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="400" name="<?php echo esc_attr( $n ); ?>[launcher_offset_x]" value="<?php echo esc_attr( $c['launcher_offset_x'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'فاصله عمودی دسکتاپ (px)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="400" name="<?php echo esc_attr( $n ); ?>[launcher_offset_y]" value="<?php echo esc_attr( $c['launcher_offset_y'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'فاصله از پایین در موبایل (px)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="240" name="<?php echo esc_attr( $n ); ?>[launcher_mobile_y]" value="<?php echo esc_attr( $c['launcher_mobile_y'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن دکمه', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[launcher_text]" value="<?php echo esc_attr( $c['launcher_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'آیکون دکمه', 'tamas-box' ); ?></label>
						<select name="<?php echo esc_attr( $n ); ?>[launcher_icon]">
							<?php foreach ( $icons as $key => $data ) : ?>
								<option value="<?php echo esc_attr( $key ); ?>" <?php selected( $c['launcher_icon'], $key ); ?>><?php echo esc_html( $data['label'] ); ?></option>
							<?php endforeach; ?>
						</select>
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ اصلی دکمه', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[launcher_color_1]" value="<?php echo esc_attr( $c['launcher_color_1'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ دوم (گرادیانت)', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[launcher_color_2]" value="<?php echo esc_attr( $c['launcher_color_2'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ آیکون دکمه', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[launcher_fg]" value="<?php echo esc_attr( $c['launcher_fg'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<?php
					$toggles = array(
						'launcher_show_text' => __( 'نمایش متن روی دکمه', 'tamas-box' ),
						'launcher_pulse'     => __( 'انیمیشن تپش دکمه', 'tamas-box' ),
						'badge'              => __( 'نشان پیام نخوانده', 'tamas-box' ),
						'sound'              => __( 'صدای پیام جدید', 'tamas-box' ),
						'auto_open'          => __( 'باز شدن خودکار چت', 'tamas-box' ),
						'powered_by'         => __( 'نمایش نوار پایین پنجره', 'tamas-box' ),
						'allow_new_chat'     => __( 'دکمه «گفتگوی جدید» برای کاربر', 'tamas-box' ),
						'require_login'      => __( 'فقط کاربران وارد شده چت کنند', 'tamas-box' ),
					);
					foreach ( $toggles as $key => $label ) :
						?>
						<div class="tmb-field tmb-switch-row">
							<label class="tmb-switch">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[<?php echo esc_attr( $key ); ?>]" value="1" <?php checked( ! empty( $c[ $key ] ), 1 ); ?>>
								<span class="tmb-slider"></span>
							</label>
							<div><strong><?php echo esc_html( $label ); ?></strong></div>
						</div>
					<?php endforeach; ?>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'تأخیر باز شدن خودکار (ثانیه)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="300" name="<?php echo esc_attr( $n ); ?>[auto_open_delay]" value="<?php echo esc_attr( $c['auto_open_delay'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'فاصله بررسی پیام جدید (ثانیه)', 'tamas-box' ); ?></label>
						<input type="number" min="2" max="60" name="<?php echo esc_attr( $n ); ?>[poll_interval]" value="<?php echo esc_attr( $c['poll_interval'] ); ?>">
						<p class="tmb-desc"><?php esc_html_e( 'وقتی چت باز است. عدد کمتر = پاسخ سریع‌تر، فشار بیشتر روی سرور.', 'tamas-box' ); ?></p>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'بررسی در حالت بسته (ثانیه)', 'tamas-box' ); ?></label>
						<input type="number" min="10" max="600" name="<?php echo esc_attr( $n ); ?>[poll_closed]" value="<?php echo esc_attr( $c['poll_closed'] ); ?>">
					</div>
				</div>
			</div>

			<!-- ============ متن‌ها ============ -->
			<div class="tmb-card">
				<h3>✍️ <?php esc_html_e( 'متن‌ها', 'tamas-box' ); ?></h3>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'عنوان پنجره چت', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[title]" value="<?php echo esc_attr( $c['title'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'زیرعنوان', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[subtitle]" value="<?php echo esc_attr( $c['subtitle'] ); ?>">
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'پیام خوش‌آمد (اولین پیام گفتگو)', 'tamas-box' ); ?></label>
					<textarea rows="3" name="<?php echo esc_attr( $n ); ?>[greeting]"><?php echo esc_textarea( $c['greeting'] ); ?></textarea>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن داخل کادر نوشتن', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[placeholder]" value="<?php echo esc_attr( $c['placeholder'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن دکمه ارسال', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[send_label]" value="<?php echo esc_attr( $c['send_label'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'نام پشتیبانی', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[agent_label]" value="<?php echo esc_attr( $c['agent_label'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'نام کاربر در چت', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[visitor_label]" value="<?php echo esc_attr( $c['visitor_label'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن وضعیت آنلاین', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[online_text]" value="<?php echo esc_attr( $c['online_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن وضعیت آفلاین', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[offline_text]" value="<?php echo esc_attr( $c['offline_text'] ); ?>">
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'پیام «الان آنلاین نیستیم»', 'tamas-box' ); ?></label>
					<textarea rows="2" name="<?php echo esc_attr( $n ); ?>[offline_notice]"><?php echo esc_textarea( $c['offline_notice'] ); ?></textarea>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'پیام بسته شدن گفتگو', 'tamas-box' ); ?></label>
						<textarea rows="2" name="<?php echo esc_attr( $n ); ?>[closed_notice]"><?php echo esc_textarea( $c['closed_notice'] ); ?></textarea>
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'پیام محدودیت ارسال', 'tamas-box' ); ?></label>
						<textarea rows="2" name="<?php echo esc_attr( $n ); ?>[rate_notice]"><?php echo esc_textarea( $c['rate_notice'] ); ?></textarea>
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'متن «در حال نوشتن»', 'tamas-box' ); ?></label>
					<input type="text" name="<?php echo esc_attr( $n ); ?>[typing_text]" value="<?php echo esc_attr( $c['typing_text'] ); ?>">
				</div>
			</div>

			<!-- ============ فرم پیش از گفتگو ============ -->
			<div class="tmb-card">
				<h3>📝 <?php esc_html_e( 'فرم پیش از گفتگو', 'tamas-box' ); ?></h3>
				<p class="tmb-desc"><?php esc_html_e( 'اگر روشن باشد، بازدیدکننده قبل از چت نام و شماره تماس خود را وارد می‌کند؛ این اطلاعات همراه اولین پیام به بله فرستاده می‌شود.', 'tamas-box' ); ?></p>

				<div class="tmb-grid-3">
					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[prechat_enabled]" value="1" <?php checked( $c['prechat_enabled'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div><strong><?php esc_html_e( 'فعال', 'tamas-box' ); ?></strong></div>
					</div>
					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[prechat_name]" value="1" <?php checked( $c['prechat_name'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div><strong><?php esc_html_e( 'فیلد نام', 'tamas-box' ); ?></strong></div>
					</div>
					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[prechat_phone]" value="1" <?php checked( $c['prechat_phone'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div><strong><?php esc_html_e( 'فیلد شماره تماس', 'tamas-box' ); ?></strong></div>
					</div>
				</div>

				<div class="tmb-field tmb-switch-row">
					<label class="tmb-switch">
						<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[prechat_required]" value="1" <?php checked( $c['prechat_required'], 1 ); ?>>
						<span class="tmb-slider"></span>
					</label>
					<div><strong><?php esc_html_e( 'پر کردن فرم اجباری باشد', 'tamas-box' ); ?></strong></div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'عنوان فرم', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[prechat_title]" value="<?php echo esc_attr( $c['prechat_title'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'برچسب فیلد نام', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[prechat_name_label]" value="<?php echo esc_attr( $c['prechat_name_label'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'برچسب فیلد تماس', 'tamas-box' ); ?></label>
						<input type="text" name="<?php echo esc_attr( $n ); ?>[prechat_phone_label]" value="<?php echo esc_attr( $c['prechat_phone_label'] ); ?>">
					</div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'متن دکمه شروع', 'tamas-box' ); ?></label>
					<input type="text" name="<?php echo esc_attr( $n ); ?>[prechat_button]" value="<?php echo esc_attr( $c['prechat_button'] ); ?>">
				</div>
			</div>

			<!-- ============ ساعات پاسخگویی ============ -->
			<div class="tmb-card">
				<h3>⏰ <?php esc_html_e( 'ساعات پاسخگویی', 'tamas-box' ); ?></h3>
				<p class="tmb-desc"><?php esc_html_e( 'خارج از این ساعت‌ها، چت با وضعیت «آفلاین» نمایش داده می‌شود اما پیام کاربر همچنان ذخیره و به بله ارسال می‌شود.', 'tamas-box' ); ?></p>

				<div class="tmb-field tmb-switch-row">
					<label class="tmb-switch">
						<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[hours_enabled]" value="1" <?php checked( $c['hours_enabled'], 1 ); ?>>
						<span class="tmb-slider"></span>
					</label>
					<div><strong><?php esc_html_e( 'محدود کردن به ساعات کاری', 'tamas-box' ); ?></strong></div>
				</div>

				<div class="tmb-field">
					<label><?php esc_html_e( 'روزهای هفته', 'tamas-box' ); ?></label>
					<div class="tmb-checkgrid tmb-daygrid">
						<?php foreach ( $days as $key => $label ) : ?>
							<label class="tmb-checkchip">
								<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[hours_days][]" value="<?php echo esc_attr( $key ); ?>" <?php checked( in_array( $key, (array) $c['hours_days'], true ) ); ?>>
								<span><?php echo esc_html( $label ); ?></span>
							</label>
						<?php endforeach; ?>
					</div>
					<p class="tmb-desc"><?php esc_html_e( 'خالی یعنی همه روزها.', 'tamas-box' ); ?></p>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'از ساعت', 'tamas-box' ); ?></label>
						<input type="time" class="ltr" name="<?php echo esc_attr( $n ); ?>[hours_from]" value="<?php echo esc_attr( $c['hours_from'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'تا ساعت', 'tamas-box' ); ?></label>
						<input type="time" class="ltr" name="<?php echo esc_attr( $n ); ?>[hours_to]" value="<?php echo esc_attr( $c['hours_to'] ); ?>">
					</div>
				</div>
				<p class="tmb-desc">
					<?php
					printf(
						/* translators: %s: current site time */
						esc_html__( 'ساعت فعلی سایت: %s', 'tamas-box' ),
						'<code>' . esc_html( current_time( 'H:i' ) ) . '</code>'
					);
					?>
				</p>
			</div>

			<!-- ============ ظاهر پنجره چت ============ -->
			<div class="tmb-card">
				<h3>🎨 <?php esc_html_e( 'ظاهر پنجره چت', 'tamas-box' ); ?></h3>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'عرض (px)', 'tamas-box' ); ?></label>
						<input type="number" min="280" max="640" name="<?php echo esc_attr( $n ); ?>[width]" value="<?php echo esc_attr( $c['width'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'ارتفاع (px)', 'tamas-box' ); ?></label>
						<input type="number" min="320" max="900" name="<?php echo esc_attr( $n ); ?>[height]" value="<?php echo esc_attr( $c['height'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'گردی گوشه‌ها (px)', 'tamas-box' ); ?></label>
						<input type="number" min="0" max="40" name="<?php echo esc_attr( $n ); ?>[radius]" value="<?php echo esc_attr( $c['radius'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ سربرگ', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[header_bg]" value="<?php echo esc_attr( $c['header_bg'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ متن سربرگ', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[header_text]" value="<?php echo esc_attr( $c['header_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'پس‌زمینه پنجره', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[panel_bg]" value="<?php echo esc_attr( $c['panel_bg'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'حباب پیام کاربر', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[bubble_visitor]" value="<?php echo esc_attr( $c['bubble_visitor'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن حباب کاربر', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[bubble_visitor_text]" value="<?php echo esc_attr( $c['bubble_visitor_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ تأکید', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[accent]" value="<?php echo esc_attr( $c['accent'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'حباب پیام پشتیبانی', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[bubble_agent]" value="<?php echo esc_attr( $c['bubble_agent'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'متن حباب پشتیبانی', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[bubble_agent_text]" value="<?php echo esc_attr( $c['bubble_agent_text'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'رنگ متن کم‌رنگ', 'tamas-box' ); ?></label>
						<input type="text" class="tmb-color" name="<?php echo esc_attr( $n ); ?>[text_muted]" value="<?php echo esc_attr( $c['text_muted'] ); ?>">
					</div>
				</div>

				<div class="tmb-preset-row">
					<?php
					$chat_presets = array(
						array( '#c99a5b', '#a97c3f', '#ffffff', '#f6f7f9' ),
						array( '#22c55e', '#16a34a', '#ffffff', '#f4f7f5' ),
						array( '#1BA5E1', '#0f7fb0', '#ffffff', '#f2f8fc' ),
						array( '#6366f1', '#4f46e5', '#ffffff', '#f5f5fb' ),
						array( '#0f172a', '#334155', '#fbbf24', '#f4f4f5' ),
						array( '#e11d48', '#be123c', '#ffffff', '#fdf4f6' ),
					);
					foreach ( $chat_presets as $preset ) :
						?>
						<button type="button" class="tmb-color-preset" data-tmb-chat-preset
							data-accent="<?php echo esc_attr( $preset[0] ); ?>"
							data-head="<?php echo esc_attr( $preset[0] ); ?>"
							data-head2="<?php echo esc_attr( $preset[1] ); ?>"
							data-fg="<?php echo esc_attr( $preset[2] ); ?>"
							data-panel="<?php echo esc_attr( $preset[3] ); ?>"
							title="<?php esc_attr_e( 'اعمال این رنگ', 'tamas-box' ); ?>"
							style="background:linear-gradient(135deg,<?php echo esc_attr( $preset[0] ); ?>,<?php echo esc_attr( $preset[1] ); ?>)"></button>
					<?php endforeach; ?>
				</div>
			</div>

			<!-- ============ امنیت ============ -->
			<div class="tmb-card">
				<h3>🛡 <?php esc_html_e( 'امنیت و نگهداری', 'tamas-box' ); ?></h3>

				<div class="tmb-grid-3">
					<div class="tmb-field">
						<label><?php esc_html_e( 'حداکثر طول پیام', 'tamas-box' ); ?></label>
						<input type="number" min="50" max="4000" name="<?php echo esc_attr( $n ); ?>[max_length]" value="<?php echo esc_attr( $c['max_length'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'حداکثر پیام در بازه', 'tamas-box' ); ?></label>
						<input type="number" min="1" max="120" name="<?php echo esc_attr( $n ); ?>[rate_limit]" value="<?php echo esc_attr( $c['rate_limit'] ); ?>">
					</div>
					<div class="tmb-field">
						<label><?php esc_html_e( 'بازه زمانی (ثانیه)', 'tamas-box' ); ?></label>
						<input type="number" min="10" max="3600" name="<?php echo esc_attr( $n ); ?>[rate_window]" value="<?php echo esc_attr( $c['rate_window'] ); ?>">
					</div>
				</div>

				<div class="tmb-grid-2">
					<div class="tmb-field">
						<label><?php esc_html_e( 'نگهداری گفتگوها (روز)', 'tamas-box' ); ?></label>
						<input type="number" min="1" max="3650" name="<?php echo esc_attr( $n ); ?>[retain_days]" value="<?php echo esc_attr( $c['retain_days'] ); ?>">
						<p class="tmb-desc"><?php esc_html_e( 'گفتگوهای قدیمی‌تر به‌صورت خودکار پاک می‌شوند.', 'tamas-box' ); ?></p>
					</div>
					<div class="tmb-field tmb-switch-row">
						<label class="tmb-switch">
							<input type="checkbox" name="<?php echo esc_attr( $n ); ?>[delete_on_uninstall]" value="1" <?php checked( $c['delete_on_uninstall'], 1 ); ?>>
							<span class="tmb-slider"></span>
						</label>
						<div>
							<strong><?php esc_html_e( 'حذف گفتگوها هنگام حذف افزونه', 'tamas-box' ); ?></strong>
							<p class="tmb-desc"><?php esc_html_e( 'جدول‌ها و فایل‌های چت از دیتابیس پاک می‌شوند.', 'tamas-box' ); ?></p>
						</div>
					</div>
				</div>

				<?php
				$counters = TMB_Chat_DB::counters();
				?>
				<p class="tmb-note">
					<strong><?php esc_html_e( 'وضعیت فعلی:', 'tamas-box' ); ?></strong>
					<?php
					printf(
						/* translators: 1: open chats, 2: unanswered */
						esc_html__( '%1$s گفتگوی باز، %2$s گفتگوی بی‌پاسخ', 'tamas-box' ),
						'<code>' . (int) $counters['open'] . '</code>',
						'<code>' . (int) $counters['unread'] . '</code>'
					);
					?>
					—
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=' . self::INBOX_SLUG ) ); ?>"><?php esc_html_e( 'باز کردن صندوق گفتگوها', 'tamas-box' ); ?></a>
				</p>

				<?php if ( ! $ready ) : ?>
					<p class="tmb-note tmb-note-warn">
						<?php esc_html_e( 'اتصال بله کامل نیست: توکن و شناسه چت مدیران را وارد کنید تا پیام‌ها به بله برسند. تا قبل از آن، گفتگوها فقط در پیشخوان سایت ذخیره می‌شوند.', 'tamas-box' ); ?>
					</p>
				<?php endif; ?>
			</div>
		</section>
		<?php
	}

	/* ---------------------------------------------------------------------
	 * Inbox
	 * ------------------------------------------------------------------ */

	/**
	 * The conversations inbox.
	 *
	 * @return void
	 */
	public function render_inbox() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		TMB_Chat_DB::maybe_install();

		$enabled  = TMB_Chat::enabled();
		$counters = TMB_Chat_DB::counters();
		$bale     = TMB_Chat_Bale::is_ready();
		?>
		<div class="wrap tmb-wrap tmb-inbox-wrap" dir="rtl">
			<h1 class="tmb-title">
				<span class="tmb-logo">تب</span>
				<?php esc_html_e( 'گفتگوهای آنلاین', 'tamas-box' ); ?>
				<span class="tmb-ver">v<?php echo esc_html( TMB_VERSION ); ?></span>
			</h1>

			<?php if ( ! $enabled ) : ?>
				<div class="notice notice-warning">
					<p>
						<?php esc_html_e( 'چت آنلاین خاموش است.', 'tamas-box' ); ?>
						<a href="<?php echo esc_url( admin_url( 'admin.php?page=tamas-box#tab-chat' ) ); ?>"><?php esc_html_e( 'فعال کردن و تنظیمات', 'tamas-box' ); ?></a>
					</p>
				</div>
			<?php elseif ( ! $bale ) : ?>
				<div class="notice notice-info">
					<p>
						<?php esc_html_e( 'بازه (بله) هنوز متصل نیست؛ گفتگوها فقط در همین‌جا ذخیره می‌شوند.', 'tamas-box' ); ?>
						<a href="<?php echo esc_url( admin_url( 'admin.php?page=tamas-box#tab-chat' ) ); ?>"><?php esc_html_e( 'اتصال به بله', 'tamas-box' ); ?></a>
					</p>
				</div>
			<?php endif; ?>

			<div class="tmb-inbox" id="tmb-inbox">
				<aside class="tmb-inbox-side">
					<div class="tmb-inbox-filters">
						<button type="button" class="tmb-inbox-filter active" data-filter=""><?php esc_html_e( 'همه', 'tamas-box' ); ?></button>
						<button type="button" class="tmb-inbox-filter" data-filter="open"><?php esc_html_e( 'باز', 'tamas-box' ); ?> <span class="tmb-count" data-count-open><?php echo (int) $counters['open']; ?></span></button>
						<button type="button" class="tmb-inbox-filter" data-filter="unread">🔴 <?php esc_html_e( 'بی‌پاسخ', 'tamas-box' ); ?> <span class="tmb-count" data-count-unread><?php echo (int) $counters['unread']; ?></span></button>
						<button type="button" class="tmb-inbox-filter" data-filter="closed"><?php esc_html_e( 'بسته', 'tamas-box' ); ?></button>
					</div>

					<div class="tmb-inbox-search">
						<input type="search" id="tmb-inbox-search" placeholder="<?php esc_attr_e( 'جستجو در نام، شماره، پیام…', 'tamas-box' ); ?>">
					</div>

					<div class="tmb-inbox-list" id="tmb-inbox-list" role="listbox" aria-label="<?php esc_attr_e( 'گفتگوها', 'tamas-box' ); ?>">
						<p class="tmb-inbox-loading"><?php esc_html_e( 'در حال بارگذاری…', 'tamas-box' ); ?></p>
					</div>

					<div class="tmb-inbox-pager">
						<button type="button" class="button" id="tmb-inbox-prev" disabled>‹ <?php esc_html_e( 'قبلی', 'tamas-box' ); ?></button>
						<span id="tmb-inbox-pageinfo">1</span>
						<button type="button" class="button" id="tmb-inbox-next" disabled><?php esc_html_e( 'بعدی', 'tamas-box' ); ?> ›</button>
					</div>
				</aside>

				<section class="tmb-inbox-main">
					<div class="tmb-inbox-empty" id="tmb-inbox-empty">
						<span class="tmb-inbox-empty-ico">💬</span>
						<p><?php esc_html_e( 'یک گفتگو را از فهرست انتخاب کنید.', 'tamas-box' ); ?></p>
					</div>

					<div class="tmb-inbox-thread" id="tmb-inbox-thread" hidden>
						<header class="tmb-thread-head">
							<div class="tmb-thread-id">
								<strong data-thread-name>—</strong>
								<span data-thread-meta></span>
							</div>
							<div class="tmb-thread-actions">
								<button type="button" class="button" data-thread-status><?php esc_html_e( 'بستن گفتگو', 'tamas-box' ); ?></button>
								<a class="button" data-thread-page href="#" target="_blank" rel="noopener"><?php esc_html_e( 'صفحه کاربر', 'tamas-box' ); ?></a>
								<button type="button" class="button button-link-delete" data-thread-delete><?php esc_html_e( 'حذف', 'tamas-box' ); ?></button>
							</div>
						</header>

						<div class="tmb-thread-info" data-thread-info></div>

						<div class="tmb-thread-body" id="tmb-thread-body" role="log"></div>

						<form class="tmb-thread-composer" id="tmb-thread-composer">
							<textarea id="tmb-thread-input" rows="2" placeholder="<?php esc_attr_e( 'پاسخ خود را بنویسید… (Enter برای ارسال، Shift+Enter برای خط جدید)', 'tamas-box' ); ?>"></textarea>
							<div class="tmb-thread-composer-actions">
								<span class="tmb-thread-hint"><?php esc_html_e( 'پاسخ شما هم در سایت و هم در بله ثبت می‌شود.', 'tamas-box' ); ?></span>
								<button type="submit" class="button button-primary button-hero"><?php esc_html_e( 'ارسال پاسخ', 'tamas-box' ); ?></button>
							</div>
						</form>
					</div>
				</section>
			</div>
		</div>
		<?php
	}

	/* ---------------------------------------------------------------------
	 * AJAX
	 * ------------------------------------------------------------------ */

	/**
	 * Guard for every AJAX call.
	 *
	 * @return void
	 */
	protected function guard() {
		check_ajax_referer( 'tmb_chat_admin', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => __( 'اجازه دسترسی ندارید.', 'tamas-box' ) ), 403 );
		}
	}

	/**
	 * Read the bot settings straight from the submitted form so the admin can
	 * test before saving.
	 *
	 * @return array { token, base }
	 */
	protected function submitted_bot() {
		$token = isset( $_POST['token'] ) ? sanitize_text_field( wp_unslash( $_POST['token'] ) ) : '';
		$base  = isset( $_POST['base'] ) ? esc_url_raw( wp_unslash( $_POST['base'] ) ) : '';

		if ( '' === $token || '' === $base ) {
			$c     = TMB_Settings::chat();
			$token = $token ? $token : $c['bale_token'];
			$base  = $base ? $base : $c['bale_api_base'];
		}

		return array(
			'token' => trim( (string) $token ),
			'base'  => untrailingslashit( (string) $base ),
		);
	}

	/**
	 * Call one method with the submitted (unsaved) credentials.
	 *
	 * @param string $method Method.
	 * @param array  $args   Arguments.
	 * @return array|WP_Error
	 */
	protected function call_with_submitted( $method, $args = array() ) {
		$bot = $this->submitted_bot();

		if ( '' === $bot['token'] ) {
			return new WP_Error( 'tmb_no_token', __( 'ابتدا توکن بازو را وارد کنید.', 'tamas-box' ) );
		}

		$response = wp_remote_post(
			$bot['base'] . $method,
			array(
				'timeout' => 25,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode( $args ),
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( ! is_array( $body ) ) {
			return new WP_Error( 'tmb_bad_response', __( 'پاسخ نامعتبر از سرور بله.', 'tamas-box' ) );
		}

		if ( empty( $body['ok'] ) ) {
			return new WP_Error(
				'tmb_bale_error',
				isset( $body['description'] ) ? $body['description'] : __( 'خطای نامشخص.', 'tamas-box' )
			);
		}

		return $body;
	}

	/**
	 * Test the token with getMe (tries both API bases when needed).
	 *
	 * @return void
	 */
	public function ajax_test() {
		$this->guard();

		$bot    = $this->submitted_bot();
		$bases  = array( $bot['base'], 'https://tapi.bale.ai/bot', 'https://tapi.bale.ai/business/bot' );
		$result = null;
		$used   = '';

		foreach ( array_unique( array_filter( $bases ) ) as $base ) {
			$bot['base'] = untrailingslashit( $base );

			$response = wp_remote_post(
				$bot['base'] . '/getMe',
				array(
					'timeout' => 20,
					'headers' => array( 'Content-Type' => 'application/json' ),
					'body'    => '{}',
				)
			);

			if ( is_wp_error( $response ) ) {
				$result = $response;
				continue;
			}

			$body = json_decode( wp_remote_retrieve_body( $response ), true );

			if ( is_array( $body ) && ! empty( $body['ok'] ) ) {
				$result = $body;
				$used   = $bot['base'];
				break;
			}

			$result = new WP_Error( 'tmb_bale_error', is_array( $body ) && isset( $body['description'] ) ? $body['description'] : __( 'پاسخ نامعتبر.', 'tamas-box' ) );
		}

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		$botinfo = isset( $result['result'] ) ? $result['result'] : array();

		wp_send_json_success(
			array(
				'message'  => sprintf(
					/* translators: 1: bot name, 2: bot username */
					__( 'اتصال برقرار است ✔ — بازو: %1$s (@%2$s)', 'tamas-box' ),
					isset( $botinfo['first_name'] ) ? $botinfo['first_name'] : '?',
					isset( $botinfo['username'] ) ? $botinfo['username'] : '?'
				),
				'base'     => $used,
				'bot'      => $botinfo,
				'business' => ( false !== strpos( (string) $used, '/business/' ) ) ? 1 : 0,
			)
		);
	}

	/**
	 * setWebhook.
	 *
	 * @return void
	 */
	public function ajax_set_webhook() {
		$this->guard();

		$url    = TMB_Chat_Bale::webhook_url();
		$result = $this->call_with_submitted( '/setWebhook', array( 'url' => $url ) );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error(
				array(
					'message' => $result->get_error_message(),
					'hint'    => __( 'اگر سایت HTTPS نیست یا وب‌هوک کار نکرد، روش دریافت را روی «دریافت خودکار» بگذارید.', 'tamas-box' ),
				)
			);
		}

		TMB_Chat_DB::set_state( 'webhook_set_at', time() );

		wp_send_json_success(
			array(
				'message' => __( 'وب‌هوک با موفقیت ثبت شد ✔', 'tamas-box' ),
				'url'     => $url,
			)
		);
	}

	/**
	 * deleteWebhook.
	 *
	 * @return void
	 */
	public function ajax_delete_webhook() {
		$this->guard();

		$result = $this->call_with_submitted( '/deleteWebhook' );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		wp_send_json_success( array( 'message' => __( 'وب‌هوک حذف شد.', 'tamas-box' ) ) );
	}

	/**
	 * getWebhookInfo.
	 *
	 * @return void
	 */
	public function ajax_webhook_info() {
		$this->guard();

		$result = $this->call_with_submitted( '/getWebhookInfo' );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( array( 'message' => $result->get_error_message() ) );
		}

		$info = isset( $result['result'] ) ? $result['result'] : array();
		$line = array();

		$line[] = __( 'آدرس ثبت‌شده:', 'tamas-box' ) . ' ' . ( ! empty( $info['url'] ) ? $info['url'] : __( 'خالی', 'tamas-box' ) );
		$line[] = __( 'آدرس مورد انتظار افزونه:', 'tamas-box' ) . ' ' . TMB_Chat_Bale::webhook_url();

		if ( isset( $info['pending_update_count'] ) ) {
			$line[] = __( 'آپدیت‌های در صف:', 'tamas-box' ) . ' ' . (int) $info['pending_update_count'];
		}
		if ( ! empty( $info['last_error_message'] ) ) {
			$line[] = __( 'آخرین خطا:', 'tamas-box' ) . ' ' . $info['last_error_message'];
		}
		if ( ! empty( $info['last_synchronization_error_message'] ) ) {
			$line[] = $info['last_synchronization_error_message'];
		}

		$ok = ( ! empty( $info['url'] ) && $info['url'] === TMB_Chat_Bale::webhook_url() );

		wp_send_json_success(
			array(
				'message' => implode( "\n", $line ),
				'match'   => $ok ? 1 : 0,
				'info'    => $info,
			)
		);
	}

	/**
	 * Manually pull updates (getUpdates) - handy right after setup.
	 *
	 * @return void
	 */
	public function ajax_poll_now() {
		$this->guard();

		TMB_Chat_DB::maybe_install();

		$count = TMB_Chat_Bale::pull_updates( 5 );

		wp_send_json_success(
			array(
				/* translators: %d: number of updates */
				'message' => sprintf( esc_html__( '%d پیام دریافت و پردازش شد.', 'tamas-box' ), (int) $count ),
				'count'   => (int) $count,
			)
		);
	}
}
